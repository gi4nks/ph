# SPEC-018 — Interaction inspection and recall integrity

- **ID**: SPEC-018
- **Cluster**: Core, Capture, Search, Memory, MCP
- **Status**: Implemented
- **Date**: 2026-10-24
- **Source**: Implemented interaction retrieval in `src/commands/search.ts`, `src/commands/show.ts`, and `src/interaction/detail.ts`, with behavior covered in `src/commands/__tests__/`.

## Purpose

Make the stored unit of PH useful and verifiable: a person can find one
interaction, inspect its complete prompt, response, capture metadata, and
derived analysis, and tell whether capture enrichment or configured remote
delivery succeeded. Keep the daily workflow small while making retrieval and
durable project knowledge consistent across adapters.

## Scope

- Add one CLI detail operation and make export formats preserve the complete
  interaction record.
- Make full-text search cover analyzed summary/insight text as well as the raw
  prompt and response.
- Make task-aware context retrieval share one project-scoped policy across CLI,
  chat, and MCP knowledge checks.
- Keep per-interaction analysis in prompt metadata. Only explicit `close` and
  MCP `save_decision` promotion write active project memories and summaries.
- Persist bounded lifecycle outcomes for optional background analysis and
  configured per-capture remote push; expose recent capture state through an
  advanced CLI diagnostic.
- Keep everyday help focused on setup, search, detail, and optional context.
  Existing maintenance and integration commands stay available through
  `ph help --all`.

## Decisions

1. `ph show <id>` is the canonical single-interaction view. It prints complete
   stored prompt and response, source/capture fields, all supported analysis
   metadata, and an explicit analysis state. Missing response and missing
   analysis are rendered as such, not silently omitted. `--json` emits the
   complete record and decoded metadata. `--archive` resolves an archived row
   using the ID printed by archived search.
2. `ph search` remains a compact discovery list and prints an actionable
   `ph show <id>` hint. `--full` means full prompt and response. Text queries
   also match analyzed summary, key insights, and technical decisions. Search
   ranking and current project/global scope rules remain stable.
3. `ph export <id>` formats all preserve prompt and response. Markdown and JSON
   also preserve complete capture and analysis metadata; plain text includes
   clear Prompt and Response headings. `--archive` exports an archived row.
4. `analyzeAll` and background analysis update only per-interaction metadata;
   they do not write `memories` or `project_summaries`. Existing saved memories
   are retained. Only `promoteProjectKnowledge`, reached through CLI `close`
   and MCP `save_decision`, creates active curated project knowledge.
5. `retrieveTaskContext` owns task embedding, project scope, shared sources, and
   explicit recent-context fallback. CLI task `context`, `chat`, and MCP
   `check_project_knowledge` use this policy. `chat` embeds the user's actual
   task prompt. General project-context retrieval without a task remains a
   separate non-semantic operation.
6. Capture records use backward-compatible optional metadata fields for
   analysis and remote-push lifecycle states. States are bounded enums and
   failure text is a safe category, never raw provider output or credentials.
   `ph status` shows the latest captures and their available state; it does not
   claim that a configured hook delivered an interaction that is absent.
7. SPEC-018 supersedes SPEC-017's “no new user-facing capability” acceptance
   only for `ph show`, complete `ph export`/`--full`, and advanced `ph status`.
   It does not remove or rename existing commands, MCP tools, or configuration.
   The only new table column is rebuildable search text derived from existing
   metadata; the migration must preserve all prompt/response records and be
   idempotent.

## Data contract

`PromptMetadata` may contain:

- `analysis_status`: `pending`, `complete`, or `failed` when analysis was
  requested; absent on legacy records is inferred as `complete` when analysis
  fields exist and otherwise `not requested`.
- `analysis_error`: one safe category (`worker_launch_failed`,
  `provider_unavailable`, `analysis_failed`, or `analysis_persistence_failed`).
- `remote_sync_status`: `pending`, `complete`, or `failed` for configured
  per-capture pushes; absent on old records is `unknown` when a remote is
  configured and `not configured` otherwise.
- `remote_sync_error`: `push_failed` only; raw response bodies are not stored.
- `technical_decisions`: per-interaction analyzed decisions, alongside
  `summary`, `key_insights`, `quality`, and `relevance`.

The FTS index receives a derived text field built from analysis summary, key
insights, and technical decisions. The existing prompt, response, and tool
fields remain indexed/scoped as before. Rebuilding FTS from existing rows must
be safe and idempotent.

## Acceptance criteria

- **G1 — Full detail**: Given a stored interaction with prompt, response,
  metadata, and analysis fields, when `ph show <id>` runs, then all are printed
  without truncation. Given missing response or analysis, then the output names
  the missing state and returns successfully.
- **G1a — Archived detail**: Given an archived search result ID, when
  `ph show <id> --archive` or `ph export <id> --archive` runs, then the original
  prompt, response, and metadata are shown without changing the archive.
- **G2 — Complete export**: Given a stored interaction, when each supported
  export format runs, then prompt and response are present; JSON includes the
  full entry and decoded metadata. Unknown IDs and formats fail with a useful
  message.
- **G3 — Search to detail**: Given a matching result, when `ph search` prints
  it, then the ID and `ph show <id>` instruction are visible. `--full` prints
  complete prompt and response. Search still honors current-project default,
  `--all`, explicit project, filters, and the requested result limit.
- **G4 — Search derived analysis**: Given only a summary, insight, or technical
  decision contains a query term, when search runs, then the source interaction
  is returned. Existing prompt/response matches and BM25 ordering continue to
  work. Updating metadata updates indexed analysis text; rebuilding old DBs
  indexes existing metadata without losing prompt history.
- **G5 — One active knowledge writer**: Given manual or background analysis,
  when it succeeds, then the interaction metadata is updated and no active
  memory or project summary is created. Given `close` approval or MCP
  `save_decision`, then the existing provenance validation and transactional
  promotion write the curated memory and summary. Existing memories remain
  readable.
- **G6 — Shared task retrieval**: Given a task prompt in a project, when CLI
  `context`, `chat`, or MCP `check_project_knowledge` retrieves context, then
  they use the same task embedding prefix, project scope, sources, and labeled
  fallback behavior. `chat` includes the user's task in the semantic query.
  Retrieval remains read-only.
- **G7 — Lifecycle status**: Given background analysis is requested, when a
  capture is stored, then its state becomes pending and transitions to complete
  or a safe failed category. Spawn failure, missing provider, empty analysis,
  provider error, and persistence error are observable. Given configured remote
  push, then its state transitions from pending to complete/failed. State writes
  do not overwrite unrelated metadata.
- **G8 — Diagnostic**: Given captured records exist, when `ph status` runs, then
  it shows a bounded recent list with timestamp, tool, project, response
  presence, analysis state, and remote state. It does not print prompt or
  response content. `status` is listed in advanced help, not the short default
  guide.
- **G9 — Small product surface**: The short guide documents setup, search,
  inspecting a result with `show`, and optional task context. Existing advanced
  commands remain available behind `ph help --all`.
- **G10 — Compatibility**: Existing DB files open without destructive rewrite;
  existing IDs, prompt/response text, config, commands, and MCP tool names stay
  intact. Analysis-derived FTS data is rebuilt transactionally or through an
  idempotent migration.

## Implementation map

| Concern | Files |
|---|---|
| Detail command, compact search, export/help | `src/cli.ts`, `src/commands/{show,search,export,status}.ts`, `src/display/print.ts` |
| Record and search index | `src/types.ts`, `src/db/index.ts`, `src/db/__tests__/phdb.test.ts` |
| Analysis lifecycle and trust | `src/analyzer/index.ts`, `src/commands/{analyze,background-analyze,log}.ts`, `src/background/analyzer.ts` |
| Task retrieval | `src/knowledge/task-context.ts`, `src/commands/{context,chat}.ts`, `src/mcp/tools/projects.ts` |
| MCP detail projection | `src/mcp/tools/prompts.ts`, `src/mcp/tools/format.ts` |
| Contracts and user docs | `docs/specs/SPEC-001-architecture-cli.md`, `SPEC-003-capture-modes.md`, `SPEC-005-search.md`, `SPEC-016-operational-memory.md`, `docs/ph-manual.md`, `README.md` |

## Verification

Focused GWT tests cover detail/export fidelity, FTS metadata indexing and
migration, memory ownership, retrieval parity/fallback, lifecycle transitions,
and status output. Completion requires `npm test`, `npm run lint`,
`npx tsc --noEmit`, and `npm run build`.

## Related

SPEC-001, SPEC-002, SPEC-003, SPEC-005, SPEC-006, SPEC-007, SPEC-011,
SPEC-016, and SPEC-017.
