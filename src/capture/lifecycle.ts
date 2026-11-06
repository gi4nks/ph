import type { PhConfig } from '../config/index.js';
import { resolveMemoryHubConfig } from '../config/runtime.js';
import { decodePromptMetadata } from '../interaction/detail.js';
import { spawnBackgroundAnalysis } from '../background/analyzer.js';
import { syncTarget } from '../sync/protocol.js';
import type { PromptEntry } from '../types.js';
import { scheduleAutomaticMemoryExtraction } from './memory-followup.js';
import { configuredRemoteUrl, pushCompletedCapture } from './remote-followup.js';
import { isSupportedCodingTool } from './tools.js';

export { configuredRemoteUrl } from './remote-followup.js';
export { isSupportedCodingTool } from './tools.js';

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
  if (isSupportedCodingTool(record.tool) && resolveMemoryHubConfig(cfg).configured && cfg.memoryAutoCapture !== false) {
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

/** Coordinate independent post-capture policies after an interaction is durable. */
export async function completeLiveCapture(dbPath: string, cfg: PhConfig, id: number): Promise<void> {
  if (cfg.backgroundAnalysis) spawnBackgroundAnalysis(id, dbPath);
  await scheduleAutomaticMemoryExtraction(dbPath, cfg, id);
  const remoteUrl = configuredRemoteUrl(cfg);
  if (remoteUrl) await pushCompletedCapture(dbPath, cfg, id, remoteUrl);
}
