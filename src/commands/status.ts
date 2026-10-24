import type { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { decodePromptMetadata } from '../interaction/detail.js';
import { getAnalysisStatus, getRemoteSyncStatus } from '../interaction/lifecycle.js';

export async function cmdStatus(db: PhDB, cfg: PhConfig): Promise<void> {
  const entries = db.search({ limit: 10 });
  process.stdout.write('PH capture status\n');
  process.stdout.write(`Background analysis: ${cfg.backgroundAnalysis ? 'enabled' : 'disabled'}\n`);
  process.stdout.write(`Remote push: ${(process.env.PH_REMOTE_URL || cfg.remoteUrl) ? 'configured' : 'not configured'}\n\n`);

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
      ` · remote: ${getRemoteSyncStatus(metadata, Boolean(process.env.PH_REMOTE_URL || cfg.remoteUrl))}\n`
    );
  }
}
