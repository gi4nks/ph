import type { PhConfig } from '../config/index.js';
import { resolveRemoteSyncConfig } from '../config/runtime.js';
import { PhDB } from '../db/index.js';
import { decodePromptMetadata } from '../interaction/detail.js';
import { patchPromptMetadata } from '../interaction/lifecycle.js';
import { sendSyncPushPage } from '../sync/client.js';
import { syncTarget } from '../sync/protocol.js';
import type { PromptEntry } from '../types.js';

export function configuredRemoteUrl(cfg: PhConfig): string | undefined {
  return resolveRemoteSyncConfig(cfg).url;
}

/** Push one completed capture and persist the same status transitions used by `ph remote`. */
export async function pushCompletedCapture(dbPath: string, cfg: PhConfig, id: number, remoteUrl: string): Promise<void> {
  let entry: PromptEntry | undefined;
  try {
    const db = new PhDB(dbPath);
    try {
      patchPromptMetadata(db, id, { capture_status: null, capture_owner_pid: null });
      entry = db.getById(id);
    } finally { db.close(); }
  } catch {
    setRemoteStatus(dbPath, id, 'failed', 'push_failed');
    return;
  }
  if (!entry) return;

  try {
    syncTarget(remoteUrl);
  } catch {
    setRemoteStatus(dbPath, id, 'failed', 'invalid_remote_url');
    process.stderr.write(`ph: invalid remote URL; interaction #${id} was saved locally but not pushed\n`);
    return;
  }

  const metadata = decodePromptMetadata(entry.metadata);
  delete metadata.analysis_status;
  delete metadata.analysis_error;
  delete metadata.remote_sync_status;
  delete metadata.remote_sync_error;
  delete metadata.remote_sync_target;
  delete metadata.capture_status;
  delete metadata.capture_owner_pid;
  const remoteEntry = { ...entry, metadata: JSON.stringify(metadata) };
  try {
    const result = await sendSyncPushPage(remoteUrl, cfg.remoteApiKey, [remoteEntry], { timeoutMs: 5_000 });
    if (result.errors.length || result.imported + result.skipped !== 1) throw new Error('Remote rejected the interaction.');
    setRemoteStatus(dbPath, id, 'complete');
  } catch {
    setRemoteStatus(dbPath, id, 'failed', 'push_failed');
    process.stderr.write(`ph: remote push failed for interaction #${id}; run ph remote status for details\n`);
  }
}

function setRemoteStatus(dbPath: string, id: number, status: 'complete' | 'failed', error?: 'push_failed' | 'invalid_remote_url'): void {
  try {
    const db = new PhDB(dbPath);
    try { patchPromptMetadata(db, id, { remote_sync_status: status, remote_sync_error: error ?? null }); }
    finally { db.close(); }
  } catch {
    process.stderr.write(`ph: could not save remote lifecycle status for interaction #${id}\n`);
  }
}
