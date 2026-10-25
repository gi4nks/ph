import { createHash } from 'node:crypto';
import path from 'node:path';
import { PhDB } from '../db/index.js';
import { load as loadConfig } from '../config/index.js';
import { getProvider, type LLMProvider } from '../ai/provider.js';
import { extractAutomaticMemories } from '../analyzer/automatic-memory.js';
import { decodePromptMetadata } from '../interaction/detail.js';
import { patchPromptMetadata } from '../interaction/lifecycle.js';
import { saveHubMemory } from './memory-hub.js';
import { detectProject } from '../runner/project.js';

export async function cmdBackgroundMemory(dbPath: string, args: string[]): Promise<void> {
  const id = Number.parseInt(args[0] ?? '', 10);
  if (!Number.isInteger(id) || id < 1) return;
  const dbIdx = args.indexOf('--db');
  const finalDbPath = dbIdx !== -1 && dbIdx + 1 < args.length ? args[dbIdx + 1] : dbPath;
  const db = new PhDB(finalDbPath);
  try {
    const cfg = loadConfig();
    let provider;
    try { provider = getProvider(cfg); } catch { provider = null; }
    if (!provider) {
      const entry = db.getById(id);
      if (entry) patchPromptMetadata(db, id, { automatic_memory_status: 'failed', automatic_memory_error: 'provider_unavailable' });
      return;
    }
    await extractAndSaveAutomaticMemory(db, id, finalDbPath, cfg, provider);
  } finally { db.close(); }
}

export async function extractAndSaveAutomaticMemory(db: PhDB, id: number, dbPath: string, cfg: import('../config/index.js').PhConfig, provider: LLMProvider): Promise<void> {
  const entry = db.getById(id);
  if (!entry) return;
  const metadata = decodePromptMetadata(entry.metadata);
  patchPromptMetadata(db, id, { automatic_memory_status: 'pending', automatic_memory_error: null });
  let candidates;
  try {
    const project = metadata.project || detectProject(entry.workdir || path.dirname(dbPath)).projectName || path.basename(entry.workdir || '');
    candidates = await extractAutomaticMemories(entry, provider, project);
  } catch {
    patchPromptMetadata(db, id, { automatic_memory_status: 'failed', automatic_memory_error: 'analysis_failed' });
    return;
  }
  if (!candidates.length) {
    patchPromptMetadata(db, id, { automatic_memory_status: 'empty', automatic_memory_ids: [], automatic_memory_error: null });
    return;
  }

  const ids: string[] = [];
  try {
    for (const [index, candidate] of candidates.entries()) {
      const sourceRef = `prompt:${id}:${index + 1}`;
      const memoryId = stableMemoryId(sourceRef);
      await saveHubMemory(cfg, {
        id: memoryId,
        content: candidate.content,
        scope: candidate.scope,
        kind: candidate.kind,
        source: 'ph-auto-capture',
        source_ref: sourceRef,
      });
      ids.push(memoryId);
    }
    patchPromptMetadata(db, id, { automatic_memory_status: 'complete', automatic_memory_ids: ids, automatic_memory_error: null });
  } catch {
    patchPromptMetadata(db, id, { automatic_memory_status: 'failed', automatic_memory_ids: ids, automatic_memory_error: 'save_failed' });
  }
}

function stableMemoryId(sourceRef: string): string {
  const bytes = createHash('sha1').update(`ph-auto-capture:${sourceRef}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
