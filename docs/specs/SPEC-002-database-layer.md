# SPEC-002: Database Layer (PhDB)

- **ID**: SPEC-002
- **Cluster**: DB
- **Status**: Implemented (baseline)
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
All persistence for ph: prompts (raw history), FTS5 full-text index, sqlite-vec
embeddings, memories, project summaries and the archive — behind a single
`PhDB` class (src/db/index.ts, ~800 lines, ~50 public methods). WAL mode, best
effort migrations, zero ORM.

## 2. Scope
- **In scope**: schema, migrations, insert/update/delete/search primitives,
  memories + summaries + archive APIs, stats.
- **Out of scope**: FTS query semantics (SPEC-005), semantic search (SPEC-008),
  retention rules (SPEC-009), sync dedup (SPEC-010).
- **Entry points**: `new PhDB(dbPath)`, `defaultPath()` (src/db/index.ts).

## 3. Data Model
- `prompts` (src/db/index.ts:56-66): id, timestamp, tool, prompt, args, workdir,
  hostname, exit_code, metadata (JSON). NOTE: `response` column is added by ALTER
  (SPEC-ISSUES-001).
- `prompts_fts` FTS5 external-content (src/db/index.ts:68-73) with AFTER INSERT /
  AFTER DELETE triggers (75-82).
- `embeddings` (legacy BLOB, 87-91) + `vec_embeddings` vec0 float[768] (100-104).
- `memories` (106-121) append-only per project; `project_summaries` (PhDB.PROJECT_SUMMARIES_SCHEMA, :123);
  `prompts_archive` (PhDB.ARCHIVE_SCHEMA, :124).
- `PromptEntry` / `PromptMetadata` / `MemoryEntry` / `ProjectSummary` types
  (src/types.ts:1-52).

## 4. Flows

### 4.1 Open + migrate (src/db/index.ts:47-196)
1. `new Database(dbPath)`; `PRAGMA journal_mode = WAL`; `sqliteVec.load(db)`.
2. CREATE TABLE IF NOT EXISTS for all tables + triggers + indexes.
3. Migrations: `$schema_version` backfill (127-136), legacy metadata column
   (139-141), `response` column (143-146), BLOB→vec0 embedding migration
   (148-180).

### 4.2 Insert (src/db/index.ts:198-218)
`insert(entry)` defaults `response ?? ''` and `metadata || '{}'`, INSERTs, FTS
trigger keeps the index in sync. Returns lastInsertRowid.

### 4.3 Read paths
- `search(opts)` (238) — see SPEC-005.
- `getById` (232), `getPromptsSince` (393), `getAllPrompts` (387),
  `getPromptCount`/`getPromptCountSince` (399-410), `getStats` (410+).
- `getPromptBySyncHash` (403-407) — used by sync dedup (SPEC-010).
- Memories: `insertMemory` (535), `upsertProjectMemory` (612),
  `upsertProjectSummary` (643), `getProjectSummary` (690) — SPEC-007.
- Archive: `archivePrompts` (464), `searchArchive` (496), `purgeArchive` (506),
  `getArchiveStats` (511) — SPEC-009.

## 5. Invariants & Business rules
- WAL mode always on; sqlite-vec loaded on every open.
- FTS index maintained by triggers (never manually rebuilt except migration).
- `metadata` is always valid JSON (`'{}'` fallback).
- All counts/read queries are typed casts on prepared statements — no ORM.

## 6. UI / UX surface
None — library layer consumed by commands, TUI, MCP and HTTP server.

## 7. Acceptance criteria (Given/When/Then)
- **G1**: Given a fresh temp DB, When `insert()` runs with a prompt, Then the
  row is retrievable via `getById` and count is 1 (src/db/index.ts:198-232).
- **G2**: Given an insert without `response`, When read back, Then `response`
  defaults to `''` (src/db/index.ts:199-201).
- **G3**: Given two prompts with the same `tool|prompt|response`, When
  `getPromptBySyncHash` runs, Then only the first match is returned
  (src/db/index.ts:403-407).
- **G4**: Given a delete, When `getById` runs, Then the entry is gone and the
  FTS trigger removed it (src/db/index.ts:79-82, 427).
- **G5**: Given `getStats()`, When run, Then total/totalMemories/byTool are
  consistent with the tables (src/db/index.ts:410+).
- **G6**: Given a fresh DB, When opened, Then `vec_embeddings` exists as a vec0
  table with float[768] (src/db/index.ts:95-104).

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| Schema + migrations | src/db/index.ts:47-196 |
| CRUD + search + sync primitives | src/db/index.ts:198-531 |
| Memories + summaries | src/db/index.ts:535-720 |
| Archive | src/db/index.ts:464-518 |
| Types | src/types.ts:1-52 |

## 9. Open questions / discrepancies
- `response` column via ALTER (SPEC-ISSUES-001).
- `memories.prompt_ids` possibly unused after summaries (SPEC-ISSUES-014).
- `delete` (427) and `deleteById` (435) coexist — duplicate deletion paths.

## 10. Related
- SPEC-005 (search), SPEC-007 (memory), SPEC-009 (retention), SPEC-010 (sync).
  No tests exist (SPEC-ISSUES-007) — this spec's GWTs are the first test targets.
