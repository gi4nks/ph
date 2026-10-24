import { PhDB } from '../db/index.js';
import { load as loadConfig } from '../config/index.js';
import { getProvider } from '../ai/provider.js';
import { analyzePrompt, mergeMetadata } from '../analyzer/index.js';
import { decodePromptMetadata } from '../interaction/detail.js';

export async function cmdBackgroundAnalyze(dbPath: string, args: string[]): Promise<void> {
  const id = parseInt(args[0], 10);
  if (isNaN(id)) return;

  let finalDbPath = dbPath;
  const dbIdx = args.indexOf('--db');
  if (dbIdx !== -1 && dbIdx + 1 < args.length) {
    finalDbPath = args[dbIdx + 1];
  }

  const db = new PhDB(finalDbPath);
  try {
    const entry = db.getById(id);
    if (!entry) return;

    db.updateMetadataFields(id, { analysis_status: 'pending', analysis_error: null });
    let provider;
    try {
      provider = getProvider(loadConfig());
    } catch {
      db.updateMetadataFields(id, { analysis_status: 'failed', analysis_error: 'provider_unavailable' });
      return;
    }
    if (!provider) {
      db.updateMetadataFields(id, { analysis_status: 'failed', analysis_error: 'provider_unavailable' });
      return;
    }

    let result;
    try {
      result = await analyzePrompt(entry.prompt, provider);
    } catch {
      db.updateMetadataFields(id, { analysis_status: 'failed', analysis_error: 'analysis_failed' });
      return;
    }
    if (Object.keys(result).length === 0) {
      db.updateMetadataFields(id, { analysis_status: 'failed', analysis_error: 'analysis_failed' });
      return;
    }
    const metadata = decodePromptMetadata(entry.metadata);
    try {
      db.updateMetadataFields(id, {
        ...mergeMetadata(metadata, result, false),
        analysis_status: 'complete',
        analysis_error: null,
      });
    } catch {
      try { db.updateMetadataFields(id, { analysis_status: 'failed', analysis_error: 'analysis_persistence_failed' }); }
      catch { /* the database itself may be unavailable */ }
    }
  } catch (_err: unknown) {
    try { db.updateMetadataFields(id, { analysis_status: 'failed', analysis_error: 'analysis_failed' }); }
    catch { /* the database itself may be unavailable */ }
  } finally {
    db.close();
  }
}
