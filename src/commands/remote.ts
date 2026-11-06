import { PhDB } from '../db/index.js';
import { load as loadConfig, save as saveConfig, getRemoteTargetState, setRemoteTargetState } from '../config/index.js';
import type { PhConfig } from '../config/index.js';
import { resolveRemoteSyncConfig } from '../config/runtime.js';
import { syncHash } from '../utils/syncHash.js';
import { parseSyncPullResponse, SYNC_PAGE_SIZE, syncTarget } from '../sync/protocol.js';
import { sendSyncPushPage } from '../sync/client.js';
import { decodePromptMetadata } from '../interaction/detail.js';
import type { PromptEntry } from '../types.js';

function remoteUrl(cfg: PhConfig): string {
  return resolveRemoteSyncConfig(cfg).url || '';
}

export async function cmdRemote(dbPath: string, args: string[]): Promise<void> {
  const cfg = loadConfig();
  const url = remoteUrl(cfg);
  if (!url) {
    process.stderr.write('ph: remote not configured. Set PH_REMOTE_URL env or: ph config set remoteUrl <url>\n');
    process.exit(1);
  }

  const sub = args[0];
  switch (sub) {
    case 'push':
      await push(dbPath, cfg, url);
      break;
    case 'pull':
      await pull(dbPath, cfg, url);
      break;
    case 'status':
      await status(dbPath, cfg, url);
      break;
    default:
      process.stdout.write(`ph remote commands:
  push               Push local prompts to remote (resumable)
  pull               Pull remote prompts into local history (resumable)
  status             Show sync status

Remote: ${url}\n`);
  }
}

async function push(dbPath: string, cfg: PhConfig, url: string): Promise<void> {
  const target = syncTarget(url);
  const db = new PhDB(dbPath);
  const databaseId = db.databaseId;
  const state = getRemoteTargetState(cfg, target, databaseId);
  let cursor = state.pushCursor ?? 0;
  let imported = 0;
  let skipped = 0;

  try {
    const initial = db.getPromptsAfterId(cursor, SYNC_PAGE_SIZE);
    if (initial.length === 0) {
      process.stdout.write('Nothing to push.\n');
      return;
    }
    process.stdout.write(`Pushing local history to ${url} in pages of ${SYNC_PAGE_SIZE}...\n`);

    while (true) {
      const candidates = db.getPromptsAfterId(cursor, SYNC_PAGE_SIZE);
      if (candidates.length === 0) break;
      const prompts: PromptEntry[] = [];
      let activeCaptureId: number | undefined;
      for (const candidate of candidates) {
        const metadata = decodePromptMetadata(candidate.metadata);
        if (metadata.capture_status === 'in_progress') {
          if (isProcessRunning(metadata.capture_owner_pid)) {
            activeCaptureId = candidate.id;
            break;
          }
          db.updateMetadataFields(candidate.id, { capture_status: null, capture_owner_pid: null });
          prompts.push(db.getById(candidate.id) ?? candidate);
        } else {
          prompts.push(candidate);
        }
      }
      if (prompts.length === 0) {
        process.stdout.write(`Waiting for active capture #${activeCaptureId}; sync cursor remains at #${cursor}.\n`);
        break;
      }
      const response = await sendSyncPushPage(url, cfg.remoteApiKey, prompts);
      if (response.errors.length || response.imported + response.skipped !== prompts.length) {
        throw new Error(`Remote rejected part of the page after local record #${cursor}; this page was not checkpointed and can be retried.`);
      }

      // Detect remote database replacement
      if (response.databaseId && state.remoteDatabaseId && response.databaseId !== state.remoteDatabaseId) {
        process.stderr.write(`ph: remote database was replaced (${state.remoteDatabaseId} -> ${response.databaseId}); resetting sync checkpoints.\n`);
        setRemoteTargetState(cfg, target, databaseId, {
          remoteDatabaseId: response.databaseId,
          pushCursor: 0,
          pullCursor: 0,
        });
        saveConfig(cfg);
        cursor = 0;
        continue;
      }

      imported += response.imported;
      skipped += response.skipped;
      cursor = prompts[prompts.length - 1].id;
      setRemoteTargetState(cfg, target, databaseId, {
        ...(response.databaseId ? { remoteDatabaseId: response.databaseId } : {}),
        pushCursor: cursor,
        lastPush: new Date().toISOString(),
      });
      saveConfig(cfg);
      process.stdout.write(`Checkpointed through local record #${cursor}.\n`);
      if (activeCaptureId !== undefined) {
        process.stdout.write(`Waiting for active capture #${activeCaptureId}; sync cursor remains at #${cursor}.\n`);
        break;
      }
      if (candidates.length < SYNC_PAGE_SIZE) break;
    }

    process.stdout.write(`Imported: ${imported}, skipped as duplicates: ${skipped}.\n`);
  } catch (err) {
    process.stderr.write(`ph: push stopped safely: ${(err as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

async function pull(dbPath: string, cfg: PhConfig, url: string): Promise<void> {
  const target = syncTarget(url);
  const db = new PhDB(dbPath);
  const databaseId = db.databaseId;
  const state = getRemoteTargetState(cfg, target, databaseId);
  let cursor = state.pullCursor ?? 0;

  try {
    process.stdout.write(`Pulling remote history from ${url} in pages of ${SYNC_PAGE_SIZE}...\n`);
    let imported = 0;
    let skipped = 0;

    while (true) {
      const res = await fetch(`${url}/api/sync/pull`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.remoteApiKey ? { Authorization: `Bearer ${cfg.remoteApiKey}` } : {}),
        },
        body: JSON.stringify({ afterId: cursor, limit: SYNC_PAGE_SIZE }),
      });
      if (!res.ok) throw new Error(`Remote error ${res.status}: ${await res.text()}`);
      const page = parseSyncPullResponse(await res.json());

      // Detect remote database replacement
      if (page.databaseId && state.remoteDatabaseId && page.databaseId !== state.remoteDatabaseId) {
        process.stderr.write(`ph: remote database was replaced (${state.remoteDatabaseId} -> ${page.databaseId}); resetting sync checkpoints.\n`);
        setRemoteTargetState(cfg, target, databaseId, {
          remoteDatabaseId: page.databaseId,
          pushCursor: 0,
          pullCursor: 0,
        });
        saveConfig(cfg);
        cursor = 0;
        continue;
      }

      if (page.prompts.length > SYNC_PAGE_SIZE) throw new Error('Remote server returned an oversized sync page.');
      if (page.prompts.length === 0 && page.hasMore) throw new Error('Remote server returned an empty page with more records pending.');
      if (page.prompts.length > 0) {
        const ids = page.prompts.map(prompt => prompt.id);
        if (ids.some((id, index) => id <= cursor || (index > 0 && id <= ids[index - 1])) || page.nextCursor !== ids[ids.length - 1]) {
          throw new Error('Remote server returned an invalid cursor order; this page was not checkpointed.');
        }
      } else if (page.nextCursor !== cursor) {
        throw new Error('Remote server returned an invalid empty-page cursor.');
      }

      for (const prompt of page.prompts) {
        const hash = syncHash(prompt);
        if (db.getPromptBySyncHash(hash)) { skipped++; continue; }
        const metaObj = { ...JSON.parse(prompt.metadata || '{}'), sync_hash: hash };
        db.insert({
          timestamp: prompt.timestamp || new Date().toISOString(),
          tool: prompt.tool || 'unknown',
          prompt: prompt.prompt || '',
          response: prompt.response || '',
          args: prompt.args || '',
          workdir: prompt.workdir || '',
          hostname: prompt.hostname || '',
          exit_code: prompt.exit_code ?? 0,
          metadata: JSON.stringify(metaObj),
        });
        imported++;
      }

      if (page.prompts.length > 0) cursor = page.nextCursor;
      setRemoteTargetState(cfg, target, databaseId, {
        ...(page.databaseId ? { remoteDatabaseId: page.databaseId } : {}),
        pullCursor: cursor,
        lastPull: new Date().toISOString(),
      });
      saveConfig(cfg);
      process.stdout.write(`Checkpointed through remote record #${cursor}.\n`);
      if (!page.hasMore) break;
    }

    process.stdout.write(`Imported: ${imported}, skipped as duplicates: ${skipped}.\n`);
  } catch (err) {
    process.stderr.write(`ph: pull stopped safely: ${(err as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

async function status(dbPath: string, cfg: PhConfig, url: string): Promise<void> {
  const target = syncTarget(url);
  const db = new PhDB(dbPath);
  try {
    const localTotal = db.getPromptCount();
    const state = getRemoteTargetState(cfg, target, db.databaseId);
    const cursor = state.pushCursor ?? 0;
    const lastPush = state.lastPush || 'never';
    const lastPull = state.lastPull || 'never';
    const remoteDbId = state.remoteDatabaseId || '(unknown until first sync)';
    const pending = db.getPromptCountAfterId(cursor);

    process.stdout.write(`Remote:            ${url}\n`);
    process.stdout.write(`Local database ID: ${db.databaseId}\n`);
    process.stdout.write(`Remote DB ID:      ${remoteDbId}\n`);
    process.stdout.write(`Local total:       ${localTotal} prompts\n`);
    process.stdout.write(`Push checkpoint:   #${cursor}\n`);
    process.stdout.write(`Pull checkpoint:   #${state.pullCursor ?? 0}\n`);
    process.stdout.write(`Last push:         ${lastPush}\n`);
    process.stdout.write(`Last pull:         ${lastPull}\n`);
    process.stdout.write(`Pending bulk push: ${pending} prompts\n`);
  } finally {
    db.close();
  }
}

function isProcessRunning(pid: number | undefined): boolean {
  if (!Number.isInteger(pid) || !pid || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM';
  }
}
