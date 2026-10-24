# SPEC-005: Search (FTS + Filters + Semantic)

- **ID**: SPEC-005
- **Cluster**: Search
- **Status**: Implemented (baseline)
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
Find prompts by full-text (FTS5 over prompt+response+derived analysis metadata), by metadata filters
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
2. With a text query → FTS path: `prompts_fts` plus the derived-analysis FTS index are matched and deduplicated by interaction, filters
   prefixed `p.` and ordered by FTS5 BM25 relevance, then recency for ties
   (db/index.ts:300-320).
3. Without text → scan path: `SELECT * FROM prompts WHERE … ORDER BY timestamp
   DESC LIMIT ?` (db/index.ts:322-330).
4. Date range: `since`/`until` become timestamp comparisons.

### 4.2 Semantic search (src/db/index.ts)
`searchSemantic(queryVector, limit, project?)` — vec0 KNN on `vec_embeddings`
joined back to prompts. When `project` is supplied, matching is restricted to
that project before the final result limit. Requires embeddings (SPEC-008).
Because sqlite-vec applies `k` before ordinary metadata predicates, scoped
queries currently examine all stored vectors before filtering and limiting.

The CLI cosine-similarity path uses the legacy embedding table. When scoped, it
loads only vectors joined to prompts whose valid metadata names the selected
project. It does not load all vectors and issue one `getById` query per vector.

### 4.3 CLI (src/commands/search.ts)
`ph search` defaults to five results and scopes to the detected current project.
`--all` searches every project; `--project` selects another project. If no
project is detected, it labels and searches all saved work. `-i` is a text-only
compatibility flag (SPEC-001); `--archive` queries `prompts_archive` (SPEC-009).

## 5. Invariants & Business rules
- FTS path is used ONLY when a text query exists; otherwise full scan + filters.
- `tag` filter is a JSON-array LIKE `%"tag"%` — substring match on the serialized
  array, not a JSON array membership check (db/index.ts:276-282).
- CLI `limit` defaults to five and must be between 1 and 1000.
- Raw prompts/responses and derived analysis remain in separate FTS5 indexes.
  Text search ranks each source list by BM25, then combines their ordinal ranks
  with Reciprocal Rank Fusion (`1 / (60 + rank)`). Results order by fused score,
  then timestamp DESC and ID DESC for deterministic ties. Raw-only query order
  retains its BM25 ordering; an interaction found in both sources receives
  evidence from both ranked lists.
- The user-facing search defaults to the current detected project; `--all`
  explicitly broadens the search. The archive path remains global.
- Project-scoped semantic search returns the nearest matching prompts within
  that project, even when closer prompts from other projects exist.
- Project-scoped CLI semantic search loads its vectors with one project join;
  malformed metadata is ignored without aborting the search.

## 6. UI / UX surface
`ph search` output: `#id tool date [tags] [exit:N]` + truncated prompt
(printResults); `--full` shows complete prompt and response and prints a `ph show <id>` hint. Search text also matches derived summary, insights, and technical decisions; a separate FTS index preserves raw prompt/response BM25 ranking.

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
- **G6**: Given an unrelated project has the nearest vector, When
  `searchSemantic(query, 1, "go-play")` runs, Then it returns the nearest
  vector belonging to `go-play` (src/db/index.ts, project scope before limit).
- **G7**: Given the CLI runs inside a detected project, When `ph search <query>`
  runs, Then it returns at most five matches from that project by default.
- **G8**: Given `ph search --all <query>`, When the command runs, Then results
  may include every project and the output labels the global scope.
- **G9**: Given matching prompts with different FTS5 scores, When the text
  search runs, Then matches from raw text and analysis are fused by RRF and
  tied results resolve by timestamp and ID (SPEC-019).
- **G10**: Given embeddings across projects, When CLI semantic search targets
  one project, Then the database returns only that project's vectors in one
  joined query and the command does not call `getById` for each vector.

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| Dual-path search | src/db/index.ts:243-330 |
| Semantic KNN | src/db/index.ts (`searchSemantic`) |
| CLI output | src/commands/search.ts, src/display/print.ts:33-60 |
| Search scope and defaults | src/commands/search.ts |
| SearchOptions | src/types.ts:54-68 |

## 9. Open questions / discrepancies
- `tag` filter uses LIKE on the JSON string — matches `"auth2"` when filtering
  `auth` (substring). JSON array membership would be stricter.
- FTS path columns need the `p.` prefix; a new filter added to only one path
  silently breaks the other (dual maintenance).
- Project-scoped semantic search on the sqlite-vec KNN path still evaluates the
  full vector set before metadata filtering because sqlite-vec's KNN limit
  precedes the join predicate. The CLI cosine path is project-filtered at load
  time. A project-aware vector index may reduce KNN cost if vector counts make
  it material.
- Semantic search has two implementations: CLI `--semantic` loads the legacy
  BLOB table and computes cosine similarity in TypeScript; task context, HTTP,
  and MCP use `sqlite-vec`. Embeddings do not record their producing model, and
  `ph embed-all` fills missing rows without rebuilding vectors after a model
  change. Consolidate the search contract and add explicit vector profile and
  rebuild behavior (ISSUE-026).

## 10. Related
- SPEC-002 (primitives), SPEC-008 (embeddings), SPEC-009 (archive),
  SPEC-011 (MCP), SPEC-010 (HTTP). Vitest coverage: `src/db/__tests__/phdb.test.ts`
  covers G1-G6, including project-scoped nearest-neighbor behavior.
