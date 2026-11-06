# AGENTS.md — Project Knowledge Base for AI Agents

## Session Progress

> The current-state summary in this section is authoritative. Older dated phase notes below are historical records and may describe workflows that have since changed.

### Goal
Keep PH simple to use: capture AI CLI work, find it with plain-text search, retrieve project context through one command, and review durable knowledge only when useful. The default invocation must never start an interactive UI.

### Current product and implementation

- **Everyday CLI**: plain-text commands for setup, history search, interaction inspection, project context, memory search, and capture status. A bare `ph` prints a short guide; there is no interactive history browser or TUI.
- **Capture**: `ph setup` configures Claude Code, Codex CLI, Gemini CLI, OpenCode, and Google Antigravity (AGY). `ph <tool>` is an optional wrapper. Importers can backfill local histories from those tools.
- **History**: interactions are stored in SQLite, normally `~/.prompt_history.db`. Search is full-text by default; `ph show <id>` displays the complete captured prompt, response, and available metadata.
- **Context**: `ph context` combines local project/work memories and relevant project interactions. It can include non-sensitive shared project/work memories when a hub is configured. Text retrieval works without embeddings; Ollama-backed vectors improve matching when available.
- **Memories**: the unified `memories` repository stores scope, kind, sensitivity, provenance, external IDs, and reversible forgotten state. Schema v4 preserves legacy memory tables and versions during migration.
- **Shared memory**: the optional authenticated HTTP memory API uses `PH_MEMORY_HUB_API_KEY`, separate from raw prompt sync. It currently has one shared key, without per-client identities, connector permissions, or an offline write queue.
- **Automatic extraction**: supported coding-agent captures can schedule bounded background extraction when a hub URL/key and inference provider are configured, unless `memory-auto-capture=false`. Candidates require exact prompt evidence and are limited to non-sensitive work/project records. The inference provider sees bounded prompt/response text; the hub gets derived records and provenance.
- **Raw history sync**: `PH_REMOTE_URL` / `remote-url` enables automatic push after completed captures. `ph remote push|pull` also supports resumable bulk sync. This transfers raw prompts/responses and is separate from the memory hub.
- **MCP**: the stdio server exposes `search_history`, `get_interaction`, `get_project_context`, `search_memories`, and `save_memory`.
- **Verification (6 November 2026)**: 143 tests across 26 files, lint, TypeScript check, and production build passed for the current working tree.

The command surface and examples in [README.md](README.md), [the user manual](docs/ph-manual.md), and [the feature catalog](docs/ph-feature-catalog.html) are the current user-facing reference. This current-state summary must be updated with code and docs when behavior changes.

### Historical design notes

[`docs/superpowers/specs/2026-06-12-ph-evolution-design.md`](docs/superpowers/specs/2026-06-12-ph-evolution-design.md) and the plans beside it record earlier proposals and implementation phases. They are historical artifacts, not a reference for today's command names or available MCP tools. Use the current README, user manual, and `ph help --all` for supported behavior.

### Current boundaries

- PH's default CLI is non-interactive and has no TUI/browser. The current workflow is `ph setup`, `ph search`, `ph show`, `ph context`, and `ph memory`.
- The memory hub has a shared bearer key, no per-client identity, no email/calendar/browser connectors, and no offline write queue.
- Automatic extraction sends bounded prompt/response excerpts to the configured inference provider. It is optional and its sensitive-data classification cannot be perfect.
- Raw-history sync can transfer full prompt/response content; configuring `PH_REMOTE_URL` enables push after new completed captures.

## Project Overview

PH is a local-first plain-text CLI for capturing, searching, and retrieving AI coding work. Its daily workflow is `ph setup`, then ordinary use of the connected coding CLIs, followed by `ph search`, `ph show`, `ph context`, or `ph memory search`. The normal `ph` command prints concise guidance; PH has no TUI or interactive history browser.

## Runtime and package

- Package: `@gi4nks/ph`; executable: `ph` (`dist/cli.js`).
- Runtime: Node.js 22 or newer; TypeScript ESM.
- Build: `tsup`; database: `better-sqlite3` and `sqlite-vec`; full-text search: SQLite FTS5.
- MCP: `@modelcontextprotocol/sdk` over local stdio.
- Quality tools: Vitest, ESLint, TypeScript.

Common development commands:

```sh
npm ci
npm run dev -- help --all
npm test
npm run lint
npx tsc --noEmit
npm run build
```

## Current source layout

```text
src/
  cli.ts                 CLI entry and dispatch
  commands/              Plain-text command handlers
  capture/               Normalized records, narrow lifecycle coordinator, and follow-up policies
  importer/              Claude, Codex, Gemini, OpenCode, and AGY history readers
  runner/                Project detection, Git context, inline wrapper
  pty/                   Interactive terminal wrapper
  db/                    SQLite facade, schema migrations, FTS, memories, archive, vectors
  context/               Local project-context retrieval and rendering
  memory/                Shared memory policy service and hub client
  analyzer/              LLM analysis and evidence-bound memory extraction
  background/            Detached analysis and memory workers
  ai/                    Ollama, Gemini, OpenRouter, and MLX-Serve adapters
  embedding/             Ollama embeddings
  mcp/                   Five-tool MCP stdio server
  server/                HTTP adapter and separately authorized memory/history APIs
  sync/                  Resumable raw-history push/pull protocol
  config/                ~/.ph_config.json load/save, runtime resolution, and provider status
hooks/                   Native tool hooks and the OpenCode plugin
 deploy/                 Generic Docker Compose memory-hub deployment
 docs/                   User manual, operations guide, specs, evaluations
```

## Current command surface

| User goal | Command |
|---|---|
| Connect capture integrations | `ph setup [claude|codex|gemini|opencode|agy...]` |
| Search current project / all projects | `ph search [options] [query]` / `ph search --all <query>` |
| Inspect a full exchange | `ph show <id> [--json] [--archive]` |
| Retrieve project knowledge | `ph context [options] [query]` |
| Search and manage durable memories | `ph memory add|list|search|show|forget|restore|retry|undo` |
| Review capture and background status | `ph status` |
| Import existing tool history | `ph import <claude|codex|gemini|opencode|agy> [options]` |
| Configure optional LLM analysis | `ph analyze`, `ph models`, `ph config` |
| Run or configure MCP | `ph mcp` |
| Run the HTTP service | `ph server [--port <port>]` |
| Sync raw interaction history | `ph remote push|pull|status` |
| Review/maintain the archive | `ph last`, `ph sessions`, `ph timeline`, `ph stats`, `ph cleanup`, `ph vacuum`, `ph export`, `ph star` |

`ph help --all` is the authoritative full command/flag listing. User-facing examples and detailed behavior belong in [README.md](README.md), [docs/ph-manual.md](docs/ph-manual.md), [docs/hooks.md](docs/hooks.md), and [docs/memory-hub.md](docs/memory-hub.md).

## Data and privacy boundaries

- The default history database is `~/.prompt_history.db`; `PH_DB` or `db-path` can change it. PH configuration is `~/.ph_config.json`, saved with mode `0600`.
- Native hooks, wrappers, and importers write prompt/response history locally first. `ph status` does not print prompt/response content.
- `PH_REMOTE_URL` or `remote-url` enables automatic push of new completed captures. `ph remote push|pull` performs resumable bulk sync. This transfers raw prompts and responses.
- Shared memory uses `PH_MEMORY_HUB_URL` and `PH_MEMORY_HUB_API_KEY`, separate from `PH_REMOTE_URL` and the prompt-sync key. If configured, `ph memory` reads/writes shared records; the local context pipeline can combine local and shared records.
- Analysis and automatic memory extraction send bounded interaction text to the configured inference provider. The hub receives derived memory records, not the raw transcript through the automatic-extraction path.
- Default search/context/MCP excludes personal and sensitive memories. Sensitive writes require explicit consent; automated extraction is constrained to work/project scope and evidence from the user prompt.

## Architecture boundaries

- `src/capture/index.ts` normalizes records. `src/capture/lifecycle.ts` is a narrow coordinator; `memory-followup.ts` and `remote-followup.ts` own extraction scheduling and raw-history delivery/status respectively.
- `src/cli.ts` keeps entry dispatch small; command behavior belongs in `src/commands/`. Unknown command names are passed through as AI-tool wrappers.
- `src/db/index.ts` exposes the `PhDB` facade and coordinates schema versioning (`SCHEMA_VERSION = 4`). `PromptRepository` owns prompt/FTS persistence and search; focused repositories own memories, archive rows, and semantic-index behavior. Migration preserves legacy memory sources and history.
- `src/memory/service.ts` owns local-versus-hub memory routing, cited-prompt validation, and shared context retrieval for CLI and MCP. The automatic extraction worker remains a separate hub-only workflow.
- `src/context/index.ts` combines project/work memory retrieval with project interactions. FTS5 always works; when embeddings exist, Ollama vectors are fused with text results using reciprocal rank fusion. Retrieval falls back to text when vectors or the provider are unavailable.
- `src/mcp/server.ts` exposes `search_history`, `get_interaction`, `get_project_context`, `search_memories`, and `save_memory`. MCP is an optional agent interface; automatic extraction does not depend on an agent calling MCP.
- `src/server/index.ts` starts the HTTP service. `request-handler.ts` owns transport parsing/bounds/errors and delegates to `routes/history.ts` or `routes/shared-memory.ts`, which retain separate auth keys. `/health` is public and returns status only. The default listener is loopback.
- `src/sync/` uses resumable row-ID pages and database-scoped cursors. Memory hub configuration does not enable raw-history sync.
- `src/config/runtime.ts` resolves environment-over-file precedence for memory hub, raw-history sync, and server authorization settings.

## Providers and configuration

- Analysis providers: Ollama (default), Gemini, OpenRouter, and MLX-Serve. Keys and model IDs use PH config or the provider environment variables documented in [the user manual](docs/ph-manual.md).
- Embeddings use Ollama. The default embedding model is `nomic-embed-text-v2-moe`; change it with `ollama-embed-model`.
- Background analysis is off by default. Automatic memory extraction schedules when hub URL/key exist and `memory-auto-capture` is not false; provider absence/failure is reported as background failure.
- Environment overrides with product-level meaning: `PH_DB`, `PH_REMOTE_URL`, `PH_MEMORY_HUB_URL`, `PH_MEMORY_HUB_API_KEY`, `PH_SERVER_API_KEY`, `PH_SERVER_HOST`, and `PH_SERVER_PORT`, plus documented inference-provider variables.

## Specifications and documentation maintenance

`docs/specs/SPEC-INDEX.md` distinguishes current specifications from historical behavior snapshots. Before changing a user workflow, read the relevant current spec and source. Update README/manual/integration documentation and the affected spec whenever observable behavior changes. Historical plans under `docs/superpowers/` and dated entries in the change log are chronology, not a current command reference.

## Current product boundaries

- No TUI/browser, email/calendar/browser connectors, per-client hub identity, offline memory-write queue, or memory conflict resolution.
- One shared memory bearer key currently authorizes hub clients.
- Automatic extraction's sensitive-data screening cannot guarantee perfect classification. The user must choose whether the configured inference service may receive bounded prompt/response excerpts.
- Raw-history sync can transmit full captured prompts and responses; users should verify the remote URL and credentials before enabling it.

## Change Log

| Date | Change |
|------|------|
| 2026-08-08 | Baseline repair: 12 TS6/@types-node-25 errors fixed (public PhDB methods replace private `db.db` access in server/remote; optional insert response, Float32Array, readSync, and node-pty typing fixes); restored lint by adding `@eslint/js`; rebuilt the better-sqlite3 ABI — tsc, lint, and build pass |
| 2026-08-08 | Baseline specifications SPEC-001…015 + SPEC-INDEX + SPEC-ISSUES (17 findings: response-column ALTER, private database access, remoteLastPush, node-pty/TS6/eslint, no tests, stale stack table, standard-version leftover, duplicated TUI bootstrap, BrowseApp monolith, sync_hash argument handling, unenforced server auth, memories.prompt_ids, duplicate display formatting) |
| 2026-08-08 | GWT test suite: 51 tests (PhDB FTS/scan/semantic search, sync dedup, archive, memories, filtering, analyzer, sessions, config) — found and fixed two filter bugs: NON_PRINTABLE matched ordinary words, and a common Italian thank-you filler was missing |
| 2026-08-08 | Refactored `openBrowser`/`runRerun` in `cli.ts` to replace three duplicated TUI startup paths with one helper; removed `standard-version` after migration to `semantic-release` |
| 2026-08-08 | Enforced server auth with a Bearer gate on every endpoint except `/health`; added a shared, args-aware, backward-compatible `syncHash`; added HTTP server end-to-end tests for health, search, stats, sync deduplication, and auth — 67 tests |
| 2026-10-09 | Shared context retrieval/formatting for CLI/chat/MCP; project-scoped semantic ranking fix; deterministic Recall@2/MRR fixture; TUI filter policy extracted/tested; normalized capture record used by wrappers and importers | TypeScript, sqlite-vec, Ink, Vitest | `src/{context,capture,ui/FilterPanel.tsx,ui/filtering.ts}`, `src/{commands,runner,importer,mcp,server,db}`, `docs/{evals,specs}/` |
| 2026-10-09 | Added Codex CLI wrapper/rerun support, native Stop hook capture, legacy and current rollout history import with workdir and final-answer pairing, TUI provider selection, and Codex documentation/spec fixtures | TypeScript, shell, Codex hooks | `src/importer/codex.ts`, `src/{commands/import.ts,cli.ts,ui/BrowseApp.tsx}`, `hooks/codex/`, `docs/` |
| 2026-10-09 | Added Wise-backed OpenRouter and MLX-Serve analysis providers, model discovery, environment-only credentials, inference-service tunnel configuration, and Node 22 runtime requirement | TypeScript, Wise, AI SDK | `src/ai/wise.ts`, `src/{ai/provider.ts,commands/models.ts,commands/config.ts,config/index.ts,cli.ts}`, `package.json`, `tsup.config.ts`, `README.md`, `docs/ph-manual.md` |
| 2026-10-09 | Added `ph config show`, hidden interactive storage for Wise provider keys with mode-0600 config, and MLX-Serve discovery showing loaded state plus actionable SSH tunnel errors | TypeScript, Wise, MLX-Serve | `src/{commands/config.ts,commands/models.ts,ai/wise.ts,ai/provider.ts,config/index.ts,cli.ts}`, `README.md`, `docs/ph-manual.md` |
| 2026-10-10 | Unified analysis-provider summaries across `ph config show`, TUI Settings, and `p`; `p` now invokes the selected Wise provider and logs its response, while `r` reruns the original CLI tool | TypeScript, Ink, Wise | `src/config/provider-summary.ts`, `src/{commands/config.ts,ui/BrowseApp.tsx,ui/Footer.tsx,ai/provider.ts,cli.ts}` |
| 2026-10-10 | Added operational memory loop: read-only task `prepare`, human-approved/editable `close` proposals with prompt provenance, shared MCP retrieval and validated `save_decision` sources; expanded offline golden retrieval contract across five projects | TypeScript, SQLite, MCP, Vitest | `src/{commands/{prepare,close}.ts,context/index.ts,mcp/server.ts,cli.ts}`, `docs/{evals,plans}/`, `README.md`, `docs/ph-manual.md` |
| 2026-10-22 | Hardened memory promotion: approved batches and summary updates now commit atomically; `ph close` checks TTY before provider calls | TypeScript, SQLite, Vitest | `src/db/index.ts`, `src/commands/close.ts`, `src/mcp/server.ts`, `src/db/__tests__/phdb.test.ts`, `docs/specs/SPEC-016-operational-memory.md` |
| 2026-10-22 | Consolidated PH architecture: scoped feature growth pending three real workflow uses; MCP composition reduced to protocol wiring with domain-grouped handlers and shared task-context/promotion use cases; memory and archive SQL extracted behind the source-compatible PhDB facade | TypeScript, SQLite, MCP, Vitest | `src/knowledge/`, `src/mcp/`, `src/db/{memory,archive}-repository.ts`, `docs/specs/SPEC-017-architecture-consolidation.md`, `ROADMAP.md` |
| 2026-10-22 | Initial workspace experiment; superseded later the same day by a plain-text CLI and removal of the TUI | TypeScript, Ink, SQLite, Vitest | `src/ui/WorkHome.tsx` (removed), `src/cli.ts`, `README.md`, `CLAUDE.md` |
| 2026-10-22 | Simplified PH to a plain-text daily workflow; removed the Ink/React browser and dependencies, unified task retrieval under `context`, and made `close` default to three hours | TypeScript, SQLite | `src/cli.ts`, `src/commands/{context,close,search}.ts`, `src/ui/`, `package.json`, `README.md`, `docs/` |
| 2026-10-22 | Simplified daily use: added idempotent `ph setup` for native Claude/Codex/Gemini/OpenCode capture integrations; default guidance now makes capture automatic and keeps search as the primary recall command | TypeScript, Node.js, Vitest | `src/commands/setup.ts`, `src/cli.ts`, `README.md`, `docs/ph-manual.md` |
| 2026-10-22 | Improved actual search use: five current-project results by default, FTS relevance ordering, explicit `--all` scope, truthful setup status, and current-directory attribution for Codex hook imports | TypeScript, SQLite FTS5, Vitest | `src/commands/search.ts`, `src/db/index.ts`, `src/importer/codex.ts`, `hooks/codex/`, `src/commands/setup.ts` |
| 2026-10-24 | Closed network/capture/search findings with regression coverage for all six: database-scoped sync cursors, byte-bounded subpages, active-capture barrier and stale-marker recovery, invalid-URL isolation including real inline execution, one-time backfill from legacy data with blank rows, and joined project embedding loads | TypeScript, Node HTTP, SQLite FTS5, Vitest | `src/{server,sync,capture,runner,commands,db}`, `src/{commands,db,runner,sync}/__tests__`, `docs/specs/{SPEC-002,SPEC-005,SPEC-010,SPEC-019,SPEC-ISSUES}` |
| 2026-10-24 | Reassessed PH after network fixes; recorded remaining remote database identity, semantic vector provenance, and startup migration findings; aligned product and operational docs with source | TypeScript, Vitest, Markdown | `docs/specs/SPEC-ISSUES.md`, `docs/specs/{SPEC-002,SPEC-005,SPEC-010}`, `README.md`, `docs/ph-manual.md` |
| 2026-10-25 | Added a generic governed-memory hub API and CLI, sensitive-save gate, reversible forget, source references, shared work/project recall in `ph context` and MCP, agent-facing shared-memory search/save tools, approved `ph close` publishing, dedicated hub credentials, and generic Docker Compose deployment | TypeScript, SQLite, Node HTTP, Docker, MCP, Vitest | `src/{db,server,commands,config,mcp}`, `deploy/`, `docs/{memory-hub.md,specs/SPEC-020*}`, `README.md`, `docs/ph-manual.md` |
| 2026-10-25 | Added automatic background memory extraction for captured coding-agent turns, exact user-prompt evidence checks, sensitive-content rejection, source-linked undo, status reporting, and an opt-out config | TypeScript, SQLite, MCP, Vitest | `src/{analyzer,background,capture,commands,config}`, `docs/{memory-hub.md,ph-manual.md,specs/SPEC-020*}`, `README.md` |
| 2026-11-06 | Deepened prompt persistence and shared-memory policy; separated capture follow-ups and HTTP memory/history routes; centralized runtime endpoint/key resolution; refreshed user documentation | TypeScript, SQLite, HTTP, MCP, Vitest | `src/{db,memory,capture,server,config,commands,mcp}`, `README.md`, `docs/{ph-manual.md,ph-feature-catalog.html}` |
