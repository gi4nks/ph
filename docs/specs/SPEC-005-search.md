# SPEC-005: Search (FTS + Filters + Semantic)

- **ID**: SPEC-005
- **Cluster**: Search
- **Status**: Implemented (baseline)
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
Find prompts by full-text (FTS5 over prompt+response), by metadata filters
(tool/project/language/role/tag/starred/quality/relevance/date range), or by
semantic similarity (sqlite-vec, SPEC-008). Backs `ph search`, the TUI text
filter, the MCP `search_prompts*` tools and the HTTP `/api/prompts/search`.

## 2. Scope
- **In scope**: `PhDB.search(opts)` dual-path (FTS vs scan), filter building,
  semantic search, `ph search` command output.
- **Out of scope**: embeddings generation (SPEC-008), archive search (SPEC-009),
  TUI filter panel (SPEC-012).
- **Entry points**: `ph search [--semantic] [--archive] [flags]`, TUI `/`, MCP tools, HTTP endpoints.

## 3. Data Model
- `SearchOptions` (src/types.ts:54-68): query, tool, project, language, role,
  tag, starred, minQuality, minRelevance, since, until, limit, semantic.
- Results: `PromptEntry[]`.

## 4. Flows

### 4.1 Dual-path query (src/db/index.ts:243-330)
1. Build identical filters for two paths: FTS (JOIN with alias `p.`) and scan
   (direct `prompts`). Filters use `json_extract` on metadata for
   project/language/role/tag/starred/quality/relevance (db/index.ts:252-297).
2. With a text query → FTS path: `prompts_fts JOIN prompts p` via MATCH, filters
   prefixed `p.` (db/index.ts:300-320).
3. Without text → scan path: `SELECT * FROM prompts WHERE … ORDER BY timestamp
   DESC LIMIT ?` (db/index.ts:322-330).
4. Date range: `since`/`until` become timestamp comparisons.

### 4.2 Semantic search (src/db/index.ts:345-360)
`searchSemantic(queryVector, limit)` — vec0 KNN on `vec_embeddings` joined back
to prompts. Requires embeddings (SPEC-008).

### 4.3 CLI (src/commands/search.ts)
`ph search` prints via `printResults` (src/display/print.ts:33); `-i` opens the
TUI (SPEC-001); `--archive` queries `prompts_archive` (SPEC-009).

## 5. Invariants & Business rules
- FTS path is used ONLY when a text query exists; otherwise full scan + filters.
- `tag` filter is a JSON-array LIKE `%"tag"%` — substring match on the serialized
  array, not a JSON array membership check (db/index.ts:276-282).
- `limit` defaults to 50 in the CLI; results ordered timestamp DESC.

## 6. UI / UX surface
`ph search` output: `#id tool date [tags] [exit:N]` + truncated prompt
(printResults); `--full` shows the complete text.

## 7. Acceptance criteria (Given/When/Then)
- **G1**: Given prompts with text "goroutines" and "react", When `search({query:
  "goroutines"})` runs, Then only the goroutines entry is returned via the FTS
  path (src/db/index.ts:300-320).
- **G2**: Given prompts from tools claude/gemini, When `search({tool: "gemini"})`
  runs (no query), Then only gemini entries are returned via the scan path
  (src/db/index.ts:322-330).
- **G3**: Given entries with metadata `project: "ph"`, When
  `search({project: "ph"})` runs, Then only those entries match via
  `json_extract` (src/db/index.ts:258-263).
- **G4**: Given a tag `auth` stored in `tags: ["auth","jwt"]`, When
  `search({tag: "auth"})` runs, Then the entry matches via the LIKE filter
  (src/db/index.ts:276-282).
- **G5**: Given `since: 2026-01-01`, When `search` runs, Then entries older than
  the date are excluded (src/db/index.ts:since handling).

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| Dual-path search | src/db/index.ts:243-330 |
| Semantic KNN | src/db/index.ts:345-360 |
| CLI output | src/commands/search.ts, src/display/print.ts:33-60 |
| SearchOptions | src/types.ts:54-68 |

## 9. Open questions / discrepancies
- `tag` filter uses LIKE on the JSON string — matches `"auth2"` when filtering
  `auth` (substring). JSON array membership would be stricter.
- FTS path columns need the `p.` prefix; a new filter added to only one path
  silently breaks the other (dual maintenance).

## 10. Related
- SPEC-002 (primitives), SPEC-008 (embeddings), SPEC-009 (archive),
  SPEC-011 (MCP), SPEC-010 (HTTP). No tests (SPEC-ISSUES-007) — G1-G5 are prime
  vitest targets.
