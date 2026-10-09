# Phase 2: Prompt Retention & Archiving — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task.

**Goal:** Add automatic retention rules and archiving mechanism so ph never grows unbounded. Old/low-quality prompts get moved to `prompts_archive` instead of deleted.

**Architecture:** New `prompts_archive` table with same schema as `prompts`. `ph cleanup --retention` scans prompts, applies rules (age, starred, analyzed, relevance), moves qualifying entries to archive. Retention config keys in `PhConfig`.

**Tech Stack:** TypeScript 5.9 ESM, better-sqlite3

## Global Constraints
- ESM only — all imports use `.js` extension
- `better-sqlite3` synchronous API
- `prompts` and `prompts_archive` have identical schema
- Build passes after every task: `npm run build`
- Archive is append-only (no deletion from archive unless `purgeArchive()` is called)

---
### Task 1: `prompts_archive` table + retention config keys + PhDB archive methods

**Files:**
- Modify: `src/config/index.ts` (add retention keys to `PhConfig`)
- Modify: `src/db/index.ts` (add archive table schema, archive/purge/search methods)

**Interfaces:**
- Produces: `db.archivePrompts(ids)`, `db.searchArchive(options)`, `db.purgeArchive(beforeDate)`, `db.getArchiveStats()` — all on PhDB
- Produces: retention config keys in `PhConfig`

- [ ] **Step 1: Add retention config keys to `PhConfig` in `src/config/index.ts`**

Add after `remoteLastPull?: string`:
```typescript
  retentionDays?: number;              // default: 90 — auto-archive prompts older than N days
  retentionMinStarred?: boolean;       // default: true — never archive starred prompts
  retentionMinAnalyzed?: boolean;      // default: true — never archive analyzed prompts (has summary or role)
  retentionMinRelevance?: number;      // default: 3 — prompts below this relevance are archived first
```

- [ ] **Step 2: Add archive table creation in `migrate()` in `src/db/index.ts`**

Add after `PROJECT_SUMMARIES_SCHEMA` static (around line 39):
```typescript
  private static readonly ARCHIVE_SCHEMA = `
    CREATE TABLE IF NOT EXISTS prompts_archive (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT    NOT NULL,
      tool      TEXT    NOT NULL,
      prompt    TEXT    NOT NULL,
      args      TEXT    NOT NULL DEFAULT '',
      workdir   TEXT    NOT NULL DEFAULT '',
      hostname  TEXT    NOT NULL DEFAULT '',
      exit_code INTEGER NOT NULL DEFAULT 0,
      metadata  TEXT    NOT NULL DEFAULT '{}',
      archived_at TEXT   NOT NULL,
      original_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_archive_timestamp ON prompts_archive(timestamp);
    CREATE INDEX IF NOT EXISTS idx_archive_original_id ON prompts_archive(original_id);
  `;
```

In `migrate()` after line 104 (`this.db.exec(PhDB.PROJECT_SUMMARIES_SCHEMA);`):
```typescript
    this.db.exec(PhDB.ARCHIVE_SCHEMA);
```

- [ ] **Step 3: Add archive methods to PhDB**

Add after the `deleteOlderThan` method (around line 439):

```typescript
  archivePrompts(ids: number[]): number {
    if (ids.length === 0) return 0;
    const now = new Date().toISOString();
    const select = this.db.prepare(`
      SELECT id, timestamp, tool, prompt, args, workdir, hostname, exit_code, metadata
      FROM prompts WHERE id = ?
    `);
    const insert = this.db.prepare(`
      INSERT INTO prompts_archive (timestamp, tool, prompt, args, workdir, hostname, exit_code, metadata, archived_at, original_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const del = this.db.prepare('DELETE FROM prompts WHERE id = ?');

    const transaction = this.db.transaction((toArchive: number[]) => {
      let count = 0;
      for (const id of toArchive) {
        const row = select.get(id) as Record<string, unknown> | undefined;
        if (!row) continue;
        insert.run(
          row.timestamp, row.tool, row.prompt, row.args,
          row.workdir, row.hostname, row.exit_code, row.metadata,
          now, id
        );
        del.run(id);
        count++;
      }
      return count;
    });

    return transaction(ids);
  }

  searchArchive(opts: { since?: string; until?: string; limit?: number }): Array<Record<string, unknown>> {
    let sql = 'SELECT * FROM prompts_archive WHERE 1=1';
    const params: unknown[] = [];
    if (opts.since) { sql += ' AND timestamp >= ?'; params.push(opts.since); }
    if (opts.until) { sql += ' AND timestamp <= ?'; params.push(opts.until); }
    sql += ' ORDER BY timestamp DESC';
    if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    return this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  }

  purgeArchive(beforeDate: string): number {
    const result = this.db.prepare('DELETE FROM prompts_archive WHERE archived_at < ?').run(beforeDate);
    return result.changes;
  }

  getArchiveStats(): { total: number; oldest: string | null; newest: string | null } {
    const row = this.db.prepare(`
      SELECT COUNT(*) as total, MIN(timestamp) as oldest, MAX(timestamp) as newest
      FROM prompts_archive
    `).get() as { total: number; oldest: string | null; newest: string | null };
    return row;
  }
```

- [ ] **Step 4: Build + verify**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/config/index.ts src/db/index.ts
git commit -m "feat: add prompts_archive table, retention config keys, archive methods"
```

---
### Task 2: `ph cleanup --retention` logic

**Files:**
- Modify: `src/commands/cleanup.ts` (add `--retention` handler)

**Interfaces:**
- Consumes: `db.archivePrompts()`, `db.searchArchive()` — from Task 1
- Produces: `ph cleanup --retention` archives prompts per retention rules

- [ ] **Step 1: Add retention logic to `cmdCleanup` in `src/commands/cleanup.ts`**

Replace the current implementation with one that handles `--retention`. Current file is 77 lines.

The retention logic:
1. If `--retention` flag is set, archive prompts matching retention rules
2. Otherwise run existing rule-based cleanup

Full replacement for `cmdCleanup`:

```typescript
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
    const starred = item.meta.starred ? ' [starred]' : '';
    const analyzed = item.meta.summary ? ' [analyzed]' : '';
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
```

- [ ] **Step 2: Update USAGE in `src/cli.ts`**

Find the `ph cleanup` line (around line 59) and update to include `--retention`:

Edit from:
```
  ph cleanup [--dry-run] [--min-length N] [--min-score N]  Remove useless prompts
```
To:
```
  ph cleanup [--dry-run] [--min-length N] [--min-score N]  Remove useless prompts
  ph cleanup --retention [--dry-run]          Archive prompts per retention policy
```

- [ ] **Step 3: Build + verify**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/commands/cleanup.ts src/cli.ts
git commit -m "feat: add ph cleanup --retention with archive logic"
```
