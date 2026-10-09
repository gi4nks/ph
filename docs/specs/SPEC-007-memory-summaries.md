# SPEC-007: Memory & Project Summaries

- **ID**: SPEC-007
- **Cluster**: Memory
- **Status**: Implemented (baseline)
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
Project-level knowledge derived from analysis: an append-only `memories` table
(full timeline per project) PLUS a single curated `project_summaries` row per
project (merged, deduped by insight/decision content). This is the "curated
knowledge base" core of the evolution plan (docs/superpowers/specs/
2026-06-12-ph-evolution-design.md).

## 2. Scope
- **In scope**: memories CRUD, upsertProjectMemory (append-only),
  upsertProjectSummary (merge/dedup), getProjectSummary, memory-migrate, access
  tracking.
- **Out of scope**: LLM analysis itself (SPEC-006), MCP exposure (SPEC-011),
  context output (SPEC-014).
- **Entry points**: analysis pipeline, `ph memory-migrate`, `ph context`,
  `ph timeline`, MCP tools, `save_decision`.

## 3. Data Model
- `memories` (src/db/index.ts:106-121): id, project, prompt_ids, summary,
  key_insights, technical_decisions, git_context_snapshot, created_at,
  updated_at, access_count, last_accessed.
- `project_summaries` (PhDB.PROJECT_SUMMARIES_SCHEMA, :123): project (PK),
  summary, key_insights, technical_decisions, prompt_count, first_analyzed,
  last_analyzed, git_context_snapshot.
- `MemoryEntry` / `ProjectSummary` (src/types.ts:29-52).

## 4. Flows

### 4.1 Append-only memory (src/db/index.ts:535-640)
`upsertProjectMemory({project, prompt_id, summary, key_insights,
technical_decisions, git_context_snapshot})` INSERTS a new row per analysis —
full timeline preserved. `searchMemories(project, limit)` returns latest N;
`getAllMemoriesByProject` (774) ascending for timelines.

### 4.2 Curated summary (src/db/index.ts:643-699)
`upsertProjectSummary(params)` upserts ONE row per project: merges new insights/
decisions into existing arrays, deduping by content; updates prompt_count,
first/last_analyzed. `getProjectSummary(project)` (690).

### 4.3 Migrate (src/commands/memory-migrate.ts)
`ph memory-migrate` backfills `project_summaries` from existing memories
(83 projects migrated per AGENTS.md).

### 4.4 Access tracking (src/db/index.ts:701)
`recordMemoryAccess(id)` bumps access_count + last_accessed (used by MCP reads).

## 5. Invariants & Business rules
- memories = append-only timeline; project_summaries = 1 row per project.
- Summary merge dedups by insight/decision CONTENT (not id).
- `save_decision` writes to summaries too (MCP, SPEC-011).
- Access stats are write-on-read (recordMemoryAccess on MCP/timeline reads).

## 6. UI / UX surface
PreviewPane memory tab (SPEC-012); `ph context` markdown output; `ph timeline`.

## 7. Acceptance criteria (Given/When/Then)
- **G1**: Given two analyses for the same project, When `upsertProjectMemory`
  runs twice, Then `memories` contains 2 rows (append-only)
  (src/db/index.ts:612-628).
- **G2**: Given two summaries with the same insight, When `upsertProjectSummary`
  runs twice, Then the insight appears once in key_insights and there is 1 row
  (src/db/index.ts:643-690).
- **G3**: Given `upsertProjectSummary` with prompt_count 3, When the row is
  read, Then prompt_count is 3 and first/last_analyzed are set
  (src/db/index.ts:643-690).
- **G4**: Given `recordMemoryAccess(id)`, When run, Then access_count
  increments and last_accessed updates (src/db/index.ts:701-706).
- **G5**: Given `ph memory-migrate` on a DB with memories but no summaries,
  When run, Then project_summaries rows are backfilled
  (src/commands/memory-migrate.ts).

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| Memories CRUD + upsert | src/db/index.ts:535-640 |
| Summary upsert/merge + read | src/db/index.ts:643-699 |
| Access tracking | src/db/index.ts:701-706 |
| Migrate command | src/commands/memory-migrate.ts |
| Evolution design | docs/superpowers/specs/2026-06-12-ph-evolution-design.md |

## 9. Open questions / discrepancies
- `memories.prompt_ids` may be load-bearing only for the timeline join; summaries
  use prompt_count (SPEC-ISSUES-014).
- Git context snapshots are captured by the analysis pipeline (git-context.ts)
  but their use beyond storage is undocumented.

## 10. Related
- SPEC-006 (analysis feeds memories), SPEC-011 (MCP tools), SPEC-014 (context/
  timeline). No tests (SPEC-ISSUES-007) — G1/G2/G3 are prime vitest targets.
