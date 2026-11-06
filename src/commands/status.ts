import type { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { decodePromptMetadata } from '../interaction/detail.js';
import { getAnalysisStatus, getRemoteSyncStatus } from '../interaction/lifecycle.js';
import { resolveMemoryHubConfig, resolveRemoteSyncConfig } from '../config/runtime.js';

export async function cmdStatus(db: PhDB, cfg: PhConfig): Promise<void> {
  const stats = db.getStats();
  const entries = db.search({ limit: 10 });
  process.stdout.write('PH capture status\n');
  process.stdout.write(`Total interactions: ${stats.total}\n`);
  process.stdout.write(`Saved memories: ${stats.totalMemories}\n`);
  process.stdout.write(`Background analysis: ${cfg.backgroundAnalysis ? 'enabled' : 'disabled'}\n`);
  const hubConfigured = resolveMemoryHubConfig(cfg).configured;
  process.stdout.write(`Automatic memory capture: ${cfg.memoryAutoCapture === false ? 'disabled' : hubConfigured ? 'enabled' : 'requires memory hub URL and key'}\n`);
  const remoteConfigured = Boolean(resolveRemoteSyncConfig(cfg).url);
  process.stdout.write(`Remote push: ${remoteConfigured ? 'configured' : 'not configured'}\n\n`);

  if (entries.length === 0) {
    process.stdout.write('No interactions have been captured yet.\n');
    return;
  }

  process.stdout.write('Recent interactions (prompt and response content hidden):\n');
  for (const entry of entries) {
    const metadata = decodePromptMetadata(entry.metadata);
    process.stdout.write(
      `#${entry.id}  ${new Date(entry.timestamp).toLocaleString()}  ${entry.tool}` +
      `${metadata.project ? `  [${metadata.project}]` : ''}\n` +
      `  response: ${entry.response ? 'captured' : 'missing'} · analysis: ${getAnalysisStatus(metadata)}` +
      ` · memory: ${metadata.automatic_memory_status ?? 'not scheduled'}` +
      ` · remote: ${getRemoteSyncStatus(metadata, remoteConfigured)}\n`
    );
  }
}
