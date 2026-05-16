import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import type { PromptMetadata } from '../types.js';
import { FilterPipeline } from '../filter/index.js';
import { parseFlags } from './_utils.js';

export async function cmdCleanup(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const dryRun = Boolean(flags['dry-run']);
  const minLength = flags['min-length'] ? Number(flags['min-length']) : (cfg.filterMinLength ?? 15);
  const minScore = flags['min-score'] ? Number(flags['min-score']) : (cfg.filterMinRelevance ?? 3);
  const days = flags['days'] ? Number(flags['days']) : undefined;

  if (days !== undefined) {
    if (dryRun) {
      console.log(`(dry-run) Would delete prompts older than ${days} days.`);
    } else {
      const deleted = db.deleteOlderThan(days);
      console.log(`Deleted ${deleted} prompts older than ${days} days.`);
    }
  }

  const allEntries = db.search({ limit: 100000 });
  console.log(`Scanning ${allEntries.length} prompts for rule-based cleanup (min-length: ${minLength}, min-score: ${minScore})...`);

  const toDelete: Array<{ id: number; prompt: string; reason: string }> = [];
  const existingHashes = new Map<string, number>();

  const filter = new FilterPipeline({ minLength, minRelevance: 0, existingHashes });

  for (const entry of allEntries) {
    const ruleResult = filter.checkRules(entry.prompt);
    if (!ruleResult.keep) {
      toDelete.push({ id: entry.id, prompt: entry.prompt, reason: `${ruleResult.reason}: ${ruleResult.details ?? ''}` });
      continue;
    }

    const hash = FilterPipeline.hashPrompt(entry.prompt);
    if (existingHashes.has(hash)) {
      const dupId = existingHashes.get(hash);
      toDelete.push({ id: entry.id, prompt: entry.prompt, reason: `exact_duplicate of #${dupId}` });
      continue;
    }
    existingHashes.set(hash, entry.id);

    if (minScore > 0) {
      let meta: PromptMetadata = {};
      try { meta = JSON.parse(entry.metadata) as PromptMetadata; } catch {}
      if (meta.relevance !== undefined && meta.relevance < minScore) {
        toDelete.push({ id: entry.id, prompt: entry.prompt, reason: `low_relevance: ${meta.relevance} < ${minScore}` });
      }
    }
  }

  if (toDelete.length === 0) {
    if (days === undefined) console.log('Nothing else to clean up.');
    return;
  }

  console.log(`\nCandidates for rule-based deletion: ${toDelete.length}`);
  for (const item of toDelete.slice(0, 30)) {
    const short = item.prompt.replace(/\n/g, ' ').slice(0, 60);
    console.log(`  #${String(item.id).padEnd(5)} [${item.reason}] "${short}"`);
  }
  if (toDelete.length > 30) {
    console.log(`  ... and ${toDelete.length - 30} more`);
  }

  if (dryRun) {
    console.log(`\n(dry-run) Would delete ${toDelete.length} more prompts. Run without --dry-run to apply.`);
    return;
  }

  const ids = toDelete.map(e => e.id);
  const deleted = db.deleteByIds(ids);
  console.log(`\nDeleted ${deleted} prompts.`);
}
