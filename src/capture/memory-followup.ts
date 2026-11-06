import type { PhConfig } from '../config/index.js';
import { PhDB } from '../db/index.js';
import { resolveMemoryHubConfig } from '../config/runtime.js';
import { isSupportedCodingTool } from './tools.js';

/** Schedule the optional, hub-only extraction for a completed coding-agent turn. */
export async function scheduleAutomaticMemoryExtraction(dbPath: string, cfg: PhConfig, id: number): Promise<void> {
  const configured = resolveMemoryHubConfig(cfg).configured && cfg.memoryAutoCapture !== false;
  if (!configured) return;

  try {
    const db = new PhDB(dbPath);
    let tool = '';
    try { tool = db.getById(id)?.tool ?? ''; } finally { db.close(); }
    if (!isSupportedCodingTool(tool)) return;
    const { spawnAutomaticMemoryExtraction } = await import('../background/automatic-memory.js');
    spawnAutomaticMemoryExtraction(id, dbPath);
  } catch {
    process.stderr.write(`ph: could not schedule automatic memory extraction for interaction #${id}\n`);
  }
}
