import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import type { PromptMetadata } from '../types.js';
import { FilterPipeline } from '../filter/index.js';
import { parseFlags } from './_utils.js';

export async function cmdCleanup(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const dryRun = Boolean(flags['dry-run']);
  const retention = Boolean(flags['retention']);

  if (retention) {
    await runRetention(db, cfg, dryRun);
    return;
  }

  // Original rule-based cleanup
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

async function runRetention(db: PhDB, cfg: PhConfig, dryRun: boolean): Promise<void> {
  const retentionDays = cfg.retentionDays ?? 90;
  const minStarred = cfg.retentionMinStarred ?? true;
  const minAnalyzed = cfg.retentionMinAnalyzed ?? true;
  const minRelevance = cfg.retentionMinRelevance ?? 3;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffStr = cutoff.toISOString();

  const allEntries = db.search({ limit: 100000 });
  const stats = db.getArchiveStats();

  console.log(`Retention policy: ${retentionDays} days, minRelevance=${minRelevance}, keepStarred=${minStarred}, keepAnalyzed=${minAnalyzed}`);
  console.log(`Archive: ${stats.total} entries (${stats.oldest ? `oldest ${stats.oldest}` : 'empty'})`);
  console.log(`Scanning ${allEntries.length} prompts...\n`);

  // Priority 1: relevance < threshold AND age > retentionDays → archive
  // Priority 2: age > retentionDays AND not starred AND not analyzed → archive
  const toArchive: Array<{ id: number; prompt: string; reason: string; meta: PromptMetadata }> = [];

  for (const entry of allEntries) {
    let meta: PromptMetadata = {};
    try { meta = JSON.parse(entry.metadata) as PromptMetadata; } catch {}

    const age = entry.timestamp;
    const isOld = age < cutoffStr;
    const isStarred = meta.starred === true;
    const isAnalyzed = Boolean(meta.summary || meta.role);
    const relevance = meta.relevance ?? 5;

    if (!isOld) continue;

    // Priority 1: low relevance + old
    if (relevance < minRelevance) {
      toArchive.push({ id: entry.id, prompt: entry.prompt, reason: `low_relevance(${relevance})`, meta });
      continue;
    }

    // Priority 2: old + not protected
    if (!(minStarred && isStarred) && !(minAnalyzed && isAnalyzed)) {
      toArchive.push({ id: entry.id, prompt: entry.prompt, reason: `old(>${retentionDays}d)`, meta });
    }
  }

  if (toArchive.length === 0) {
    console.log('No prompts match retention criteria.');
    return;
  }

  console.log(`Candidates for archiving: ${toArchive.length}`);
  for (const item of toArchive.slice(0, 20)) {
    const short = item.prompt.replace(/\n/g, ' ').slice(0, 60);
    const starred = item.meta.starred ? ' *' : '';
    const analyzed = item.meta.summary ? ' [A]' : '';
    console.log(`  #${String(item.id).padEnd(5)} [${item.reason}]${starred}${analyzed} "${short}"`);
  }
  if (toArchive.length > 20) {
    console.log(`  ... and ${toArchive.length - 20} more`);
  }

  if (dryRun) {
    console.log(`\n(dry-run) Would archive ${toArchive.length} prompts. Run without --dry-run to apply.`);
    return;
  }

  const ids = toArchive.map(e => e.id);
  const archived = db.archivePrompts(ids);
  console.log(`\nArchived ${archived} prompts.`);

  // Auto-purge: archived entries older than 2x retentionDays
  const purgeCutoff = new Date();
  purgeCutoff.setDate(purgeCutoff.getDate() - retentionDays * 2);
  const purged = db.purgeArchive(purgeCutoff.toISOString());
  if (purged > 0) {
    console.log(`Purged ${purged} archived entries older than ${retentionDays * 2} days.`);
  }
}
