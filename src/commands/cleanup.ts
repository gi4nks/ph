import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import type { PromptEntry, PromptMetadata } from '../types.js';
import { FilterPipeline } from '../filter/index.js';
import { parseFlags } from './_utils.js';

const BATCH_SIZE = 500;

interface CleanupCandidate {
  id: number;
  preview: string;
  reason: string;
}

interface RetentionCandidate {
  id: number;
  preview: string;
  reason: string;
  meta: PromptMetadata;
}

function previewPrompt(prompt: string): string {
  return prompt.replace(/\n/g, ' ').slice(0, 60);
}

function parseMetadata(raw: string): PromptMetadata {
  try { return JSON.parse(raw) as PromptMetadata; } catch { return {}; }
}

/** Stream all prompts in ascending ID pages so memory stays bounded. */
function forEachPromptBatch(db: PhDB, onBatch: (batch: PromptEntry[]) => void): number {
  let cursor = 0;
  let scanned = 0;
  while (true) {
    const batch = db.getPromptsAfterId(cursor, BATCH_SIZE);
    if (batch.length === 0) break;
    scanned += batch.length;
    onBatch(batch);
    cursor = batch[batch.length - 1].id;
  }
  return scanned;
}

export async function cmdCleanup(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const dryRun = Boolean(flags['dry-run']);
  const retention = Boolean(flags['retention']);

  if (retention) {
    await runRetention(db, cfg, dryRun);
    return;
  }

  // Rule-based cleanup
  const minLength = flags['min-length'] ? Number(flags['min-length']) : (cfg.filterMinLength ?? 15);
  const minScore = flags['min-score'] ? Number(flags['min-score']) : (cfg.filterMinRelevance ?? 3);
  const days = flags['days'] ? Number(flags['days']) : undefined;
  const olderThanDays = flags['older-than'] ? Number(flags['older-than']) : undefined;
  const projectFilter = typeof flags['project'] === 'string' ? flags['project'] : undefined;
  const onlyEmpty = Boolean(flags['empty']);
  const onlyDuplicates = Boolean(flags['duplicates']);

  if (days !== undefined) {
    if (dryRun) {
      console.log(`(dry-run) Would delete prompts older than ${days} days.`);
    } else {
      const deleted = db.deleteOlderThan(days);
      console.log(`Deleted ${deleted} prompts older than ${days} days.`);
    }
  }

  const olderThanCutoffStr = olderThanDays !== undefined && Number.isFinite(olderThanDays) && olderThanDays > 0
    ? new Date(Date.now() - olderThanDays * 86_400_000).toISOString()
    : undefined;
  const explicitMode = onlyEmpty || onlyDuplicates || olderThanCutoffStr !== undefined;

  const totalPrompts = db.getPromptCount();
  console.log(`Scanning ${totalPrompts} prompts for rule-based cleanup (min-length: ${minLength}, min-score: ${minScore})...`);

  const candidates = new Map<number, CleanupCandidate>();
  // Keep the newest prompt per normalized hash (matching original DESC scan behavior).
  const seenByHash = new Map<string, { id: number; timestamp: string; preview: string }>();
  const filter = new FilterPipeline({ minLength, minRelevance: 0 });

  forEachPromptBatch(db, (batch) => {
    for (const entry of batch) {
      const meta = parseMetadata(entry.metadata);
      if (projectFilter && meta.project !== projectFilter) continue;

      const preview = previewPrompt(entry.prompt);

      if (explicitMode) {
        if (onlyEmpty && entry.prompt.trim().length === 0) {
          candidates.set(entry.id, { id: entry.id, preview, reason: 'empty: prompt is empty' });
          continue;
        }
        if (olderThanCutoffStr && entry.timestamp < olderThanCutoffStr) {
          candidates.set(entry.id, { id: entry.id, preview, reason: `older_than: >${olderThanDays}d` });
          continue;
        }
        if (onlyDuplicates) {
          const hash = FilterPipeline.hashPrompt(entry.prompt);
          const prev = seenByHash.get(hash);
          if (!prev) {
            seenByHash.set(hash, { id: entry.id, timestamp: entry.timestamp, preview });
          } else if (entry.timestamp >= prev.timestamp) {
            candidates.set(prev.id, { id: prev.id, preview: prev.preview, reason: `exact_duplicate of #${entry.id}` });
            seenByHash.set(hash, { id: entry.id, timestamp: entry.timestamp, preview });
          } else {
            candidates.set(entry.id, { id: entry.id, preview, reason: `exact_duplicate of #${prev.id}` });
          }
        }
        continue;
      }

      const ruleResult = filter.checkRules(entry.prompt);
      if (!ruleResult.keep) {
        candidates.set(entry.id, { id: entry.id, preview, reason: `${ruleResult.reason}: ${ruleResult.details ?? ''}` });
        continue;
      }

      const hash = FilterPipeline.hashPrompt(entry.prompt);
      const prev = seenByHash.get(hash);
      if (!prev) {
        seenByHash.set(hash, { id: entry.id, timestamp: entry.timestamp, preview });
      } else if (entry.timestamp >= prev.timestamp) {
        candidates.set(prev.id, { id: prev.id, preview: prev.preview, reason: `exact_duplicate of #${entry.id}` });
        seenByHash.set(hash, { id: entry.id, timestamp: entry.timestamp, preview });
      } else {
        candidates.set(entry.id, { id: entry.id, preview, reason: `exact_duplicate of #${prev.id}` });
        continue;
      }

      if (minScore > 0 && meta.relevance !== undefined && meta.relevance < minScore) {
        candidates.set(entry.id, { id: entry.id, preview, reason: `low_relevance: ${meta.relevance} < ${minScore}` });
      }
    }
  });

  const toDelete = [...candidates.values()];

  if (toDelete.length === 0) {
    if (days === undefined) console.log('Nothing else to clean up.');
    return;
  }

  console.log(`\nCandidates for rule-based deletion: ${toDelete.length}`);
  for (const item of toDelete.slice(0, 30)) {
    console.log(`  #${String(item.id).padEnd(5)} [${item.reason}] "${item.preview}"`);
  }
  if (toDelete.length > 30) {
    console.log(`  ... and ${toDelete.length - 30} more`);
  }

  if (dryRun) {
    console.log(`\n(dry-run) Would delete ${toDelete.length} more prompts. Run without --dry-run to apply.`);
    return;
  }

  const ids = toDelete.map(e => e.id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    deleted += db.deleteByIds(ids.slice(i, i + BATCH_SIZE));
  }
  console.log(`\nDeleted ${deleted} prompts.`);
}

export async function runRetention(db: PhDB, cfg: PhConfig, dryRun: boolean): Promise<void> {
  const retentionDays = cfg.retentionDays ?? 90;
  const minStarred = cfg.retentionMinStarred ?? true;
  const minAnalyzed = cfg.retentionMinAnalyzed ?? true;
  const minRelevance = cfg.retentionMinRelevance ?? 3;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffStr = cutoff.toISOString();

  const stats = db.getArchiveStats();
  const totalPrompts = db.getPromptCount();

  console.log(`Retention policy: ${retentionDays} days, minRelevance=${minRelevance}, keepStarred=${minStarred}, keepAnalyzed=${minAnalyzed}`);
  console.log(`Archive: ${stats.total} entries (${stats.oldest ? `oldest ${stats.oldest}` : 'empty'})`);
  console.log(`Scanning ${totalPrompts} prompts...\n`);

  // Priority 1: relevance < threshold AND age > retentionDays → archive
  // Priority 2: age > retentionDays AND not starred AND not analyzed → archive
  const toArchive: RetentionCandidate[] = [];

  forEachPromptBatch(db, (batch) => {
    for (const entry of batch) {
      const meta = parseMetadata(entry.metadata);
      const isOld = entry.timestamp < cutoffStr;
      if (!isOld) continue;

      const isStarred = meta.starred === true;
      const isAnalyzed = Boolean(meta.summary || meta.role);
      const relevance = meta.relevance ?? 5;
      const preview = previewPrompt(entry.prompt);

      // Priority 1: low relevance + old
      if (relevance < minRelevance) {
        toArchive.push({ id: entry.id, preview, reason: `low_relevance(${relevance})`, meta });
        continue;
      }

      // Priority 2: old + not protected
      if (!(minStarred && isStarred) && !(minAnalyzed && isAnalyzed)) {
        toArchive.push({ id: entry.id, preview, reason: `old(>${retentionDays}d)`, meta });
      }
    }
  });

  if (toArchive.length === 0) {
    console.log('No prompts match retention criteria.');
    return;
  }

  console.log(`Candidates for archiving: ${toArchive.length}`);
  for (const item of toArchive.slice(0, 20)) {
    const starred = item.meta.starred ? ' *' : '';
    const analyzed = item.meta.summary ? ' [A]' : '';
    console.log(`  #${String(item.id).padEnd(5)} [${item.reason}]${starred}${analyzed} "${item.preview}"`);
  }
  if (toArchive.length > 20) {
    console.log(`  ... and ${toArchive.length - 20} more`);
  }

  if (dryRun) {
    console.log(`\n(dry-run) Would archive ${toArchive.length} prompts. Run without --dry-run to apply.`);
    return;
  }

  const ids = toArchive.map(e => e.id);
  let archived = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    archived += db.archivePrompts(ids.slice(i, i + BATCH_SIZE));
  }
  console.log(`\nArchived ${archived} prompts.`);

  // Auto-purge: archived entries older than 2x retentionDays
  const purgeCutoff = new Date();
  purgeCutoff.setDate(purgeCutoff.getDate() - retentionDays * 2);
  const purged = db.purgeArchive(purgeCutoff.toISOString());
  if (purged > 0) {
    console.log(`Purged ${purged} archived entries older than ${retentionDays * 2} days.`);
  }
}
