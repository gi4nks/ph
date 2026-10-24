import { PhDB } from '../db/index.js';
import { load as loadConfig, save as saveConfig } from '../config/index.js';
import type { PhConfig } from '../config/index.js';
import { syncHash } from '../utils/syncHash.js';
import { parseSyncPullResponse, SYNC_PAGE_SIZE, syncTarget } from '../sync/protocol.js';
import { sendSyncPushPage } from '../sync/client.js';
import { decodePromptMetadata } from '../interaction/detail.js';
import type { PromptEntry } from '../types.js';

function remoteUrl(cfg: PhConfig): string {
  return process.env.PH_REMOTE_URL || cfg.remoteUrl || '';
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
  let cursor = cfg.remotePushCursor?.target === target && cfg.remotePushCursor.databaseId === databaseId
    ? cfg.remotePushCursor.id
    : 0;
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

      imported += response.imported;
      skipped += response.skipped;
      cursor = prompts[prompts.length - 1].id;
      cfg.remotePushCursor = { target, databaseId, id: cursor };
      cfg.remoteLastPush = new Date().toISOString();
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
  // A legacy timestamp cursor cannot express a stable page boundary. Replay from
  // row zero and rely on sync_hash so existing records remain idempotent.
  let cursor = cfg.remotePullCursor?.target === target && cfg.remotePullCursor.databaseId === databaseId
    ? cfg.remotePullCursor.id
    : 0;

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
      cfg.remotePullCursor = { target, databaseId, id: cursor };
      cfg.remoteLastPull = new Date().toISOString();
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
    const cursor = cfg.remotePushCursor?.target === target && cfg.remotePushCursor.databaseId === db.databaseId
      ? cfg.remotePushCursor.id
      : 0;
    const lastPush = cfg.remoteLastPush || 'never';
    const lastPull = cfg.remoteLastPull || 'never';
    const pending = db.getPromptCountAfterId(cursor);

    process.stdout.write(`Remote:      ${url}\n`);
    process.stdout.write(`Local total: ${localTotal} prompts\n`);
    process.stdout.write(`Last push:   ${lastPush}\n`);
    process.stdout.write(`Last pull:   ${lastPull}\n`);
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
