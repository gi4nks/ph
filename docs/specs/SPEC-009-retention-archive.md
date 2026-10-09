# SPEC-009: Retention & Archive

- **ID**: SPEC-009
- **Cluster**: DB
- **Status**: Implemented (baseline)
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
Keeps the DB "shrinking, not growing" (evolution plan): `ph cleanup --retention`
archives old/unqualified prompts to `prompts_archive` (removing them from the
live tables) and auto-purges archived entries past 2× retentionDays.

## 2. Scope
- **In scope**: retention policy (age, starred, analyzed, relevance), archive
  move (transactional copy+delete incl. embeddings cleanup), archive search,
  purge, archive stats.
- **Out of scope**: simple `ph cleanup` (length/score deletion), reusability
  cleanup (SPEC-006 cross-ref).
- **Entry points**: `ph cleanup --retention [--dry-run]`, `ph search --archive`,
  TUI archive count.

## 3. Data Model
- `prompts_archive` (PhDB.ARCHIVE_SCHEMA, src/db/index.ts:124): full row copy +
  `archived_at`, `original_id`.
- Config keys (src/config/index.ts:18-21): retentionDays (90), retentionMinStarred
  (true), retentionMinAnalyzed (true), retentionMinRelevance (3).
- Archive stats: total/oldest/newest (src/db/index.ts:511).

## 4. Flows

### 4.1 Selection (src/commands/cleanup.ts:88-133)
1. cutoff = now − retentionDays.
2. Priority 1: relevance < threshold AND older than cutoff (cleanup.ts:104-105).
3. Priority 2: older than cutoff AND not starred AND not analyzed (cleanup.ts:105+).
4. `--dry-run` lists candidates; otherwise confirm/`--force` then archive.

### 4.2 Archive move (src/db/index.ts:464-493)
`archivePrompts(ids)` runs a TRANSACTION: copy row → prompts_archive (with
archived_at/original_id), DELETE from prompts (FTS trigger + embeddings cleanup
deleteByIds at :439 keep the indexes consistent). Returns moved count.

### 4.3 Purge (src/db/index.ts:506, cleanup.ts:157-162)
After archiving, entries in prompts_archive older than 2× retentionDays are
permanently purged.

### 4.4 Archive search (src/db/index.ts:496)
`searchArchive({since, until, limit})` over prompts_archive; CLI `ph search
--archive`.

## 5. Invariants & Business rules
- Archive move is transactional — no partial copies.
- Starred and analyzed prompts are never archived by default (config flags).
- Embeddings of archived prompts are deleted (deleteByIds handles vec cleanup).
- Purge only touches prompts_archive, never live prompts.

## 6. UI / UX surface
TUI header shows `N prompts (M archived)` (Header.tsx archiveCount prop);
`ph cleanup --retention` prints policy + per-entry reasons.

## 7. Acceptance criteria (Given/When/Then)
- **G1**: Given an old, unstarred, unanalyzed prompt, When retention selection
  runs, Then it is a candidate for archiving (src/commands/cleanup.ts:105+).
- **G2**: Given `archivePrompts([id])` on an existing prompt, When run, Then the
  row moves to prompts_archive with archived_at+original_id and disappears from
  prompts (src/db/index.ts:464-493).
- **G3**: Given an archived entry older than 2× retentionDays, When
  `purgeArchive` runs, Then it is deleted (src/db/index.ts:506-510).
- **G4**: Given `searchArchive({since})`, When run, Then only archived rows in
  range are returned (src/db/index.ts:496-505).
- **G5**: Given `getArchiveStats()`, When run, Then total/oldest/newest reflect
  prompts_archive (src/db/index.ts:511-518).

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| Retention policy + selection | src/commands/cleanup.ts:88-133 |
| Archive move (transaction) | src/db/index.ts:464-493 |
| Archive search + purge + stats | src/db/index.ts:496-518 |
| Config keys | src/config/index.ts:18-21 |
| TUI archive count | src/ui/Header.tsx, BrowseApp.tsx:793 |

## 9. Open questions / discrepancies
- "Analyzed" is defined as `meta.summary || meta.role` (cleanup.ts) — verify the
  exact predicate when wiring tests.
- `deleteByIds` (439) does the vec cleanup; `archivePrompts` relies on it —
  archive + vec consistency is only as good as deleteByIds.

## 10. Related
- SPEC-002 (primitives), SPEC-006 (reusability cleanup), SPEC-012 (TUI count).
  No tests (SPEC-ISSUES-007) — G2/G3 are prime vitest targets.
