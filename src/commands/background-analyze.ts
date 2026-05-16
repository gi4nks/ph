import { PhDB } from '../db/index.js';
import { load as loadConfig } from '../config/index.js';
import { getProvider } from '../ai/provider.js';
import { analyzePrompt, mergeMetadata } from '../analyzer/index.js';
import type { PromptMetadata } from '../types.js';

export async function cmdBackgroundAnalyze(dbPath: string, args: string[]): Promise<void> {
  const id = parseInt(args[0], 10);
  if (isNaN(id)) return;

  let finalDbPath = dbPath;
  const dbIdx = args.indexOf('--db');
  if (dbIdx !== -1 && dbIdx + 1 < args.length) {
    finalDbPath = args[dbIdx + 1];
  }

  const cfg = loadConfig();
  const provider = getProvider(cfg);
  if (!provider) return;

  const db = new PhDB(finalDbPath);
  try {
    const entry = db.getById(id);
    if (!entry) return;

    const result = await analyzePrompt(entry.prompt, provider);
    if (Object.keys(result).length === 0) return;

    let existing: PromptMetadata = {};
    try { existing = JSON.parse(entry.metadata) as PromptMetadata; } catch {}

    const merged = mergeMetadata(existing, result, false);
    db.updateMetadata(id, JSON.stringify(merged));

    // Populate project memory
    if (result.project && result.summary) {
      db.upsertProjectMemory({
        project: result.project,
        prompt_id: id,
        summary: result.summary,
        key_insights: result.key_insights ?? [],
        technical_decisions: result.technical_decisions ?? [],
      });
    }
  } catch (_err: unknown) {
  } finally {
    db.close();
  }
}
