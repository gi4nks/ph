import type { PhConfig } from '../config/index.js';
import { PhDB } from '../db/index.js';
import { decodePromptMetadata } from '../interaction/detail.js';
import { patchPromptMetadata } from '../interaction/lifecycle.js';
import { spawnBackgroundAnalysis } from '../background/analyzer.js';
import { spawnAutomaticMemoryExtraction } from '../background/automatic-memory.js';
import { sendSyncPushPage } from '../sync/client.js';
import type { PromptEntry } from '../types.js';
import { syncTarget } from '../sync/protocol.js';

export function configuredRemoteUrl(cfg: PhConfig): string | undefined {
  return process.env.PH_REMOTE_URL || cfg.remoteUrl || undefined;
}

export function prepareLiveCapture<T extends Omit<PromptEntry, 'id'>>(
  record: T,
  cfg: PhConfig,
  options: { inProgress?: boolean } = {},
): T {
  const metadata = decodePromptMetadata(record.metadata);
  if (cfg.backgroundAnalysis) {
    metadata.analysis_status = 'pending';
    delete metadata.analysis_error;
  }
  if (automaticMemoryEnabled(cfg) && isSupportedCodingTool(record.tool)) {
    metadata.automatic_memory_status = 'pending';
    delete metadata.automatic_memory_error;
  }
  const remoteUrl = configuredRemoteUrl(cfg);
  if (remoteUrl) {
    if (options.inProgress) {
      metadata.capture_status = 'in_progress';
      metadata.capture_owner_pid = process.pid;
    }
    try {
      metadata.remote_sync_status = 'pending';
      delete metadata.remote_sync_error;
      metadata.remote_sync_target = syncTarget(remoteUrl);
    } catch {
      metadata.remote_sync_status = 'failed';
      metadata.remote_sync_error = 'invalid_remote_url';
      delete metadata.remote_sync_target;
    }
  }
  return { ...record, metadata: JSON.stringify(metadata) };
}

/** Apply configured follow-up work to a persisted live interaction, regardless of capture adapter. */
export async function completeLiveCapture(dbPath: string, cfg: PhConfig, id: number): Promise<void> {
  if (cfg.backgroundAnalysis) spawnBackgroundAnalysis(id, dbPath);
  if (automaticMemoryEnabled(cfg)) {
    try {
      const db = new PhDB(dbPath);
      try {
        const entry = db.getById(id);
        if (entry && isSupportedCodingTool(entry.tool)) spawnAutomaticMemoryExtraction(id, dbPath);
      } finally { db.close(); }
    } catch {
      process.stderr.write(`ph: could not schedule automatic memory extraction for interaction #${id}\n`);
    }
  }
  const remoteUrl = configuredRemoteUrl(cfg);
  if (!remoteUrl) return;

  let entry: PromptEntry | undefined;
  try {
    const db = new PhDB(dbPath);
    try {
      patchPromptMetadata(db, id, { capture_status: null, capture_owner_pid: null });
      entry = db.getById(id);
    }
    finally { db.close(); }
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
  delete metadata.automatic_memory_status;
  delete metadata.automatic_memory_ids;
  delete metadata.automatic_memory_error;
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

export function automaticMemoryEnabled(cfg: PhConfig): boolean {
  const hubUrl = process.env.PH_MEMORY_HUB_URL || cfg.memoryHubUrl;
  const hubKey = process.env.PH_MEMORY_HUB_API_KEY || cfg.memoryHubApiKey;
  return Boolean(hubUrl && hubKey) && cfg.memoryAutoCapture !== false;
}

export function isSupportedCodingTool(tool: string): boolean {
  return ['claude', 'codex', 'gemini', 'opencode'].includes(tool.trim().toLowerCase());
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
