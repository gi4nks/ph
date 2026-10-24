# AGENTS.md — Project Knowledge Base for AI Agents

## Session Progress

### Goal
Keep PH simple to use: capture AI CLI work, find it with plain-text search, retrieve project context through one command, and review durable knowledge only when useful. The default invocation must never start an interactive UI.

### Completed
- **Phase 0**: `cli.ts` ~1500→~80 lines; 19 command handlers → `src/commands/*.ts`
- **Phase 1 (original)**: `sqlite-vec` integrated, `vec_embeddings` + `memories` tables, auto-migration from old BLOB embeddings
- **Phase 2.1–2.3**: `ANALYSIS_PROMPT` requests `summary`/`key_insights`/`technical_decisions`; analysis persists derived interaction metadata and does not write project memories. Shared `ph context` returns relevant project knowledge and prompts as Markdown.
- **Phase 3.2**: MCP tools `search_project_memory`, `get_project_context`, `get_project_summary`
- **Context integration**: `ph chat <tool> <prompt>` injects project context; the legacy TUI shortcut was retired in 2026-10-22
- **Legacy UI (retired 2026-10-22)**: the Ink/React history browser and its keybindings were removed; use the plain-text CLI.
- **Memory**: `upsertProjectMemory` is append-only → full timeline per project
- **Memory merging**: `upsertProjectSummary()` merges explicitly promoted knowledge into the project summary (dedup by insight/decision content) — `project_summaries` table has 1 row per project
- **Retention**: `ph cleanup --retention` archives old/unqualified prompts to `prompts_archive` table based on configurable rules (age, starred, analyzed, relevance)
- **Docs**: `AGENTS.md` fully rewritten; `ROADMAP_RAG.md` updated with completed phases checked
- **OpenCode importer**: `src/importer/opencode.ts` reads from SQLite DB (`~/.local/share/opencode/opencode.db`), paired 186 user messages with responses, imported 151 prompts into ph after dedup
- **OpenCode plugin**: `hooks/opencode/ph-plugin.ts` — real-time capture via OpenCode plugin hooks (`chat.message` + `experimental.text.complete`). Pairs user prompts with streamed assistant responses, calls `ph log` in background. Install script at `hooks/opencode/install.sh`.
- **MCP prompt history tools**: `search_prompts`, `get_prompt`, `search_prompts_semantic` added to `src/mcp/server.ts` — full-text search, by-ID lookup, and vector search over raw prompt history
- **Shared project context**: `src/context/index.ts` centralizes summary, memory, and prompt retrieval plus Markdown rendering for `ph context`, `ph chat`, and MCP `get_project_context`; semantic queries are scoped in the database before the result limit. Focused context and nearest-neighbor scope tests added.
- **Capture seam**: `src/capture/index.ts` normalizes records from direct log, wrappers, and history importers.
- **HTTP server (`ph server`)**: `src/server/index.ts` — lightweight REST API using Node `http` (no deps). Data routes require a configured Bearer key; startup fails without one. Default bind is loopback, health returns status only, and request bodies are capped at 32 MiB.
- **Remote sync (`ph remote`)**: `src/commands/remote.ts` — resumable row-ID pages (500 entries) for push and pull. Cursors are scoped to the normalized target and local database UUID; cursor advancement waits for full acknowledgement/insertion; `sync_hash` makes retries idempotent. Legacy timestamp cursors trigger a replay from row zero. Current limitations: only one cursor per direction is retained (switching back to another DB replays it), the server database generation is not part of cursor identity, and last-push/pull timestamps are global.
- **Live capture lifecycle**: `src/capture/lifecycle.ts` initializes and completes configured analysis and remote-push work for `ph log`, inline wrapper, and interactive PTY wrapper. Per-interaction network push has a five-second timeout.
- **Env/config remote URL**: `PH_REMOTE_URL` env var takes precedence over `ph config set remoteUrl`. Config comment uses generic placeholder — no hardcoded server names.
- **semantic-release**: Replaced `standard-version` with `semantic-release` for automated CI/CD. Release workflow runs on push to `main`, bumps version via conventional commits, publishes to npm with OIDC provenance.
- **OIDC trusted publishing**: Package published with provenance attestation via GitHub Actions (`id-token: write`). Publisher identity: `GitHub Actions <npm-oidc-no-reply@github.com>`.
- **Ubuntu server setup**: Added systemd service template for `ph server` as a remote sync daemon.

### Completed
- **Timeline CLI**: `ph timeline <project>` — full chronological project history with prompts, analysis, memories interleaved in markdown. Added `getAllPromptsByProject()` and `getAllMemoriesByProject()` to PhDB with ascending order queries.
- **MCP `get_project_timeline`**: Returns full project timeline (prompts + memories in chronological order) via stdio. Auto-discovered by any MCP client.
- **MCP `check_project_knowledge`**: AI agents call this before implementing a feature. Searches memories (keyword match) + semantic prompt search for previous implementations, discussions, and technical decisions. Returns "found" or "new work" recommendation.
- **Operational memory workflow (2026-10-10; simplified 2026-10-22)**: task-aware `ph context` builds a read-only brief through shared retrieval with provenance and bounded excerpts (`ph prepare` is a compatibility alias); `ph close` reviews selected prompts, proposes durable knowledge, and requires interactive approval before saving memories and updating summaries. MCP uses the same context boundary and validates prompt provenance on `save_decision`.
- **Product simplification (2026-10-22)**: `ph` prints a short command guide; task-aware retrieval is unified under `ph context`; `ph close` defaults to the last three hours. The Ink/React browser was removed. Advanced maintenance and integration commands remain available through `ph help --all`.
- **Setup-first workflow (2026-10-22)**: `ph setup` installs native Claude Code, Codex, Gemini, and OpenCode capture integrations while preserving existing settings, and distinguishes new from existing integrations. `ph search` defaults to five relevant matches in the current project; Codex hook capture associates the active CLI working directory with imported turns. Daily use does not require wrappers, manual context injection, or `ph close`.

### Evolution Plan (`docs/superpowers/specs/2026-06-12-ph-evolution-design.md`)
- **Phase 1 (complete)**: `project_summaries`, summary merge and deduplication, `ph memory-migrate`, explicit knowledge promotion writes memories and summaries, MCP summary access, and `save_decision` persistence.
- **Phase 2 (complete)**: `prompts_archive`, `ph cleanup --retention`, configurable retention rules, and automatic purging of entries older than twice the retention period.
- **Phase 3 (complete)**: MCP memory search falls back to project summaries when semantic search has no results; `check_project_knowledge` and `save_decision` are available.
- **Phase 4 (complete)**: TUI archive count, archived prompt search, and retention cleanup.
- Task 2.4 (Git state tracking) remains deferred.

### Known Issues
- Removed the unused interactive browser and React/Ink dependencies on 2026-10-22; the command-line path is now plain text.
- Verification after retrieval, TUI, capture, importer, MCP, PTY, and SemanticIndex changes: 85 Vitest tests across 15 files; ESLint, TypeScript check, and build pass (2026-10-09).
  - Additional verification: maintainer-judged retrieval dataset and model-backed runner; MCP protocol smoke test; Claude/Gemini/OpenCode/Codex importer fixtures; PTY response cleanup tests. Run `npm run eval:retrieval` when configured Ollama returns 768-dimensional embeddings.

## Project Overview

**`ph`** (Prompt History & Analysis) is a local history and project-context tool for AI CLI work (Claude Code, Codex CLI, Gemini CLI, OpenCode, etc.). It captures interactions through native hooks or wrapper mode, stores them in SQLite, and provides plain-text search and project-context retrieval.

Three modes of capture:
- **Wrapper mode**: `ph claude "explain goroutines"` — wraps a CLI tool transparently
- **Hook mode**: AI CLI tools invoke `ph-hook.sh` scripts post-session (zero friction)
- **Direct**: `ph log --tool claude --prompt "..." --response "..."` or via stdin JSON

## Directory Layout

```
src/
  cli.ts              # Entry point — concise help and manual command dispatch
  types.ts            # Core interfaces (PromptEntry, PromptMetadata, SearchOptions, MemoryEntry)
  commands/
    _utils.ts         # Shared helpers: parseFlags(), parseDate()
    search.ts         # ph search — full-text & semantic search
    context.ts        # ph context — RAG context for current project
    last.ts           # ph last — show recent prompts
    sessions.ts       # ph sessions — session grouping
    stats.ts          # ph stats — statistics
    cluster.ts        # ph cluster — K-means clustering
    analyze.ts        # ph analyze — LLM analysis
    analyze-reusability.ts  # ph analyze-reusability
    cleanup.ts        # ph cleanup — rule-based cleanup
    cleanup-reusability.ts  # ph cleanup-reusability
    star.ts           # ph star — toggle bookmark
    export.ts         # ph export — prompt export
    import.ts         # ph import — Gemini/Claude/OpenCode/Codex import
    log.ts            # ph log — direct logging (hook target)
    models.ts         # ph models — discover OpenRouter and MLX-Serve model IDs
    embed-all.ts      # ph embed-all — batch embedding
    config.ts         # ph config — get/set config
    vacuum.ts         # ph vacuum — DB compaction
    background-analyze.ts  # internal _bg-analyze worker
    chat.ts           # ph chat — context-injected tool wrapper
    wrap.ts           # ph <tool> — wrapper mode entry
  ai/
    provider.ts       # LLMProvider interface + factory
    wise.ts           # Wise/AI SDK adapter for OpenRouter and MLX-Serve
    ollama.ts         # Ollama provider
    gemini.ts         # Gemini API provider
  analyzer/
    index.ts          # Prompt analysis (role/tag/relevance extraction via LLM)
    reusability.ts    # Reusability scoring engine
  background/
    analyzer.ts       # Spawns detached child process for async analysis
  cluster/
    index.ts          # K-means clustering on embeddings
  config/
    index.ts          # ~/.ph_config.json loader/saver
  db/
    index.ts          # PhDB class — SQLite operations (~470 lines incl. memory methods)
  display/
    print.ts          # Terminal output formatting
  embedding/
    index.ts          # Ollama embedding generation (768-dim)
  filter/
    index.ts          # FilterPipeline — dedup, trivial prompt filtering
  importer/
    claude.ts         # Import from Claude Code history
    gemini.ts         # Import from Gemini CLI history
    opencode.ts       # Import from OpenCode history
    codex.ts          # Import Codex rollout JSONL history
   mcp/
     server.ts         # MCP stdio server (tools: search_project_memory, search_prompts, get_prompt, search_prompts_semantic, etc.)
   server/
     index.ts          # HTTP REST server for remote sync (zero deps, Node http module)
   pty/
    wrapper.ts        # PTY process wrapper for interactive mode
  runner/
    git-context.ts    # Git branch/diff capture
    inline.ts         # Non-interactive wrapper mode
    project.ts        # Project/language auto-detection
  sessions/
    index.ts          # Session grouping + cohesion scoring
  stats/
    index.ts          # Statistics computation
  utils/
    extractTopic.ts   # Title extraction from prompt text
hooks/
  claude/ph-hook.sh   # Claude Code Stop hook (shell script)
  codex/ph-hook.sh    # Codex CLI Stop hook (shell script)
  gemini/ph-hook.sh   # Gemini CLI AfterAgent hook (shell script)
docs/                 # Documentation files
  ph-manual.md        # Comprehensive architecture guide
dist/                 # Build output (gitignored)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 6.0 ESM (`"type": "module"`) |
| Runtime | Node.js 20+ |
| Build | `tsup` 8.5 — `src/cli.ts` → `dist/cli.js` |
| DB | SQLite via `better-sqlite3` 12.8 (WAL mode, FTS5) |
| Vector | `sqlite-vec` 0.1 (native `vec0`, 768-dim) |
| PTY | `@lydell/node-pty` 1.2 (local typings shim, `src/pty/node-pty.d.ts`) |
| MCP | `@modelcontextprotocol/sdk` 1.29 |
| Validation | `zod` 4.3 |
| Linting | ESLint 9 + TypeScript (`@eslint/js` in devDeps) |
| Testing | `vitest` 4.1 — 85 tests / 15 files |
| Release | `semantic-release` 25 (conventional commits) |
| Dev Runner | `tsx` 4.21 |

## Everyday Commands

| Command | Function |
|---------|----------|
| `<tool>` | Run an AI CLI tool and capture the interaction |
| `search` | Find earlier work with plain-text or semantic search |
| `context [task]` | Retrieve project knowledge and relevant interactions |
| `close [--since 3h]` | Review recent work and approve durable knowledge |

`prepare` remains a compatibility alias for task-aware `context`. Maintenance,
import, MCP, and sync commands are available with `ph help --all` and are not
part of the everyday workflow.

## Database Schema (SQLite at `~/.prompt_history.db`)

```sql
-- Main table
CREATE TABLE prompts (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT    NOT NULL,            -- ISO-8601
    tool      TEXT    NOT NULL,            -- 'claude', 'gemini', etc.
    prompt    TEXT    NOT NULL,            -- user prompt text
    response  TEXT    NOT NULL DEFAULT '',
    args      TEXT    NOT NULL DEFAULT '',
    workdir   TEXT    NOT NULL DEFAULT '',
    hostname  TEXT    NOT NULL DEFAULT '',
    exit_code INTEGER NOT NULL DEFAULT 0,
    metadata  TEXT    NOT NULL DEFAULT '{}'  -- JSON PromptMetadata
);

-- FTS5 full-text search
CREATE VIRTUAL TABLE prompts_fts USING fts5(prompt, response, tool UNINDEXED, content='prompts', content_rowid='id');

-- Vector search (sqlite-vec)
CREATE VIRTUAL TABLE vec_embeddings USING vec0(embedding float[768]);

-- Legacy embeddings table
CREATE TABLE embeddings (prompt_id INTEGER PRIMARY KEY, vector BLOB NOT NULL);

-- Project memory / semantic knowledge store (Phase 0+)
CREATE TABLE IF NOT EXISTS memories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project     TEXT    NOT NULL,
    prompt_ids  TEXT    NOT NULL DEFAULT '[]',
    summary     TEXT    NOT NULL,
    key_insights    TEXT NOT NULL DEFAULT '[]',
    technical_decisions TEXT NOT NULL DEFAULT '[]',
    git_context_snapshot TEXT,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,
    access_count INTEGER DEFAULT 0,
    last_accessed TEXT
);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
```

### `metadata` JSON structure

```typescript
interface PromptMetadata {
  title?: string;
  project?: string;
  language?: string;
  role?: 'debug' | 'refactor' | 'explain' | 'review' | 'architect' | 'test' | 'docs' | 'generate' | 'research';
  tags?: string[];
  starred?: boolean;
  relevance?: number;      // 0-10
  quality?: number;        // 0-10
  summary?: string;
  key_insights?: string[];
  git_context?: { branch: string; files: string[]; diff: string };
  $schema_version?: number;  // for forward-compatible schema evolution
}
```

### `MemoryEntry` interface

```typescript
interface MemoryEntry {
  id: number;
  project: string;
  prompt_ids: number[];
  summary: string;
  key_insights: string[];
  technical_decisions: string[];
  git_context_snapshot?: string;
  created_at: string;
  updated_at: string;
  access_count: number;
  last_accessed?: string;
}
```

## Configuration (`~/.ph_config.json`)

```typescript
interface PhConfig {
  geminiApiKey?: string;
  dbPath?: string;                    // default: ~/.prompt_history.db
  analyzeProvider?: 'ollama' | 'gemini' | 'openrouter' | 'mlx-serve'; // default: ollama
  ollamaUrl?: string;                 // default: http://localhost:11434
  ollamaModel?: string;               // default: llama3.1:latest
  openrouterModel?: string;           // exact provider/model ID
  openrouterUrl?: string;             // default: https://openrouter.ai/api/v1
  openrouterApiKey?: string;           // local config; overridden by OPENROUTER_API_KEY
  mlxServeModel?: string;             // exact model ID from MLX-Serve
  mlxServeUrl?: string;               // default: http://127.0.0.1:11234/v1 via SSH tunnel
  mlxServeApiKey?: string;            // local config; overridden by MLX_SERVE_API_KEY / GLB_OMLX_API_KEY
  ollamaEmbedModel?: string;          // default: nomic-embed-text-v2-moe
  filterMinLength?: number;           // default: 15
  filterMinRelevance?: number;        // default: 3
  backgroundAnalysis?: boolean;       // default: false — runs after each completed live capture
  retentionDays?: number;             // default: 90 — auto-archive prompts older than N days
  retentionMinStarred?: boolean;      // default: true — starred prompts never auto-archived
  retentionMinAnalyzed?: boolean;     // default: true — analyzed prompts never auto-archived
  retentionMinRelevance?: number;     // default: 3 — prompts with relevance below threshold pruned first
  remoteUrl?: string;                 // HTTP URL of remote ph server (or set PH_REMOTE_URL env)
  remoteApiKey?: string;              // required to start HTTP server; client Bearer key
  remoteLastPush?: string;            // global timestamp of last successful push
  remoteLastPull?: string;            // ISO timestamp of last successful pull
  remotePushCursor?: { target: string; databaseId: string; id: number }; // target + local DB scoped cursor
  remotePullCursor?: { target: string; databaseId: string; id: number }; // target + local DB scoped cursor
}
```

### Enabling Auto-Analysis

```bash
ph config set background-analysis true
```

After each `ph log ...` command or hook invocation, optional background analysis enriches captured interaction metadata. It does not append project memory entries; only reviewed `ph close` proposals and MCP `save_decision` promote durable knowledge.

## Key Architecture Patterns

- **ESM only**: all imports use `.js` extension
- **Manual arg parsing**: `cli.ts``s `main()` uses `parseFlags()` — no commander/yargs
- **Commands in `src/commands/`**: each command (`search`, `context`, `analyze`, etc.) has its own file exporting `cmdXxx(db, cfg?, args?)`, dispatched via switch in `cli.ts`
- **`ph chat`**: wrapper that auto-injects project context (memories + recent prompts) before forwarding to the tool
- **Background analysis**: spawns detached child process via `spawnBackgroundAnalysis()` — never blocks
- **Auto-analysis**: enabled via `ph config set background-analysis true` — runs `_bg-analyze` after each `ph log` capture
- **Multiple memories**: explicitly promoted decisions create append-only entries in `memories`; analysis output stays on its source interaction
- **Memory pipeline**: analysis enriches the source interaction metadata; `ph close` approval or MCP `save_decision` explicitly promotes source-backed knowledge through `upsertProjectMemory()`
- **`ph context`**: outputs both project-level knowledge (from `memories`) + recent prompt interactions (markdown, pipe-ready)
- **Import with analysis**: `ph import gemini --analyze` runs inline LLM analysis on imported prompts (supports `gemini`, `claude`, `opencode`, `codex`)
- **Memory merging**: `upsertProjectSummary()` merges explicitly promoted knowledge into the project summary (dedup by insight/decision content) — `project_summaries` table has 1 row per project
- **Retention**: `ph cleanup --retention` archives old/unqualified prompts to `prompts_archive` table based on configurable rules (age, starred, analyzed, relevance)
- **MCP summary fallback**: `search_project_memory` returns `project_summaries` content when semantic search yields no results
- **Search archive**: `ph search --archive` queries the `prompts_archive` table
- **MCP server**: exposes `search_project_memory`, `get_project_context` (with memories), `get_project_summary` tools
- **Hooks**: shell scripts in `hooks/<tool>/ph-hook.sh`, invoked by AI CLI tools, pipe JSON to `ph log`
- **OpenCode importer**: reads from the SQLite DB at `~/.local/share/opencode/opencode.db` — queries `session`, `message`, and `part` tables; assistant messages link to user via `parentID` in `message.data` JSON
- **Metadata merging**: `mergeMetadata()` in `analyzer/index.ts` merges new analysis with existing metadata (preserves manual fields unless force=true)
- **Filter pipeline**: 4 checks (too short, non-printable, trivial pattern, exact duplicate) + optional relevance filter
- **Project detection**: walks up directory tree checking `.git`, `go.mod`, `package.json`, `Cargo.toml`, etc.
- **Remote sync**: HTTP server requires a Bearer key and binds loopback by default. Push/pull use target- and local-database-scoped row-ID pages, byte-bounded push subpages, full acknowledgement before cursor advancement, and idempotent `sync_hash` deduplication. Only the most recently used database cursor is retained; switching back causes a full replay. Remote database replacement at the same URL is not detected; last-success timestamps are global.
- **Live follow-up**: `completeLiveCapture` dispatches configured analysis and a bounded per-interaction remote push consistently for direct log and both wrapper modes.
- **Env overrides**: `PH_REMOTE_URL` env var takes precedence over config file `remoteUrl`. No server names hardcoded in code.

## Important Files for Quick Reference

- `src/cli.ts` — main entry, short help and manual command dispatch
- `src/commands/` — all command modules
- `src/commands/chat.ts` — context-injected tool wrapper
- `src/db/index.ts` — PhDB class, all SQL + memory operations
- `src/types.ts` — PromptEntry, PromptMetadata, MemoryEntry, SearchOptions
- `src/analyzer/index.ts` — analysis prompt + mergeMetadata + analyzeAll
- `src/ai/provider.ts` — LLM provider abstraction
- `src/background/analyzer.ts` — background analysis spawner
- `src/mcp/server.ts` — MCP server with memory + prompt history tools
- `src/server/index.ts` — HTTP REST server for remote sync (zero deps)
- `src/commands/remote.ts` — `ph remote push|pull|status`
- `src/commands/log.ts` — `ph log` with bounded remote push after capture
- `src/importer/opencode.ts` — OpenCode history importer
- `src/importer/codex.ts` — Codex rollout history importer
- `hooks/claude/ph-hook.sh` — Claude Code hook
- `hooks/codex/ph-hook.sh` — Codex CLI hook
- `hooks/gemini/ph-hook.sh` — Gemini CLI hook
- `docs/ph-manual.md` — comprehensive architecture guide

## Spec-Driven Development (2026-08-08)

- Baseline specs in `docs/specs/` — `SPEC-INDEX.md` (registry + cluster map),
  `SPEC-ISSUES.md` (cross-cutting discrepancies), `_TEMPLATE.md`.
- **SPEC-001…015** = baseline reverse-engineered from code (ph as it is today;
  regression targets). Same format as lens/harness (`path:line` evidence, ≥3 GWT
  per spec, §9 open questions — never invent behavior).
- `ph` specifications document current behavior; integrations such as MCP,
  the HTTP server, and sync are existing features rather than proposed targets.
- When behavior changes, update the relevant specification (status and GWT)
  and SPEC-ISSUES. Mark an issue fixed with the date when its fix is complete.
- GWT criteria → Vitest: tests in `src/**/__tests__/` (DB/search/memory/
  archive/sync dedup, analyzer parse/merge, sessions, config, context,
  normalized capture, import formats, MCP tool
  call, PTY response cleanup, deterministic retrieval regression).

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
| 2026-10-09 | Added Wise-backed OpenRouter and MLX-Serve analysis providers, model discovery, environment-only credentials, Parmenide tunnel configuration, and Node 22 runtime requirement | TypeScript, Wise, AI SDK | `src/ai/wise.ts`, `src/{ai/provider.ts,commands/models.ts,commands/config.ts,config/index.ts,cli.ts}`, `package.json`, `tsup.config.ts`, `README.md`, `docs/ph-manual.md` |
| 2026-10-09 | Added `ph config show`, hidden interactive storage for Wise provider keys with mode-0600 config, and MLX-Serve discovery showing loaded state plus actionable SSH tunnel errors | TypeScript, Wise, MLX-Serve | `src/{commands/config.ts,commands/models.ts,ai/wise.ts,ai/provider.ts,config/index.ts,cli.ts}`, `README.md`, `docs/ph-manual.md` |
| 2026-10-10 | Unified analysis-provider summaries across `ph config show`, TUI Settings, and `p`; `p` now invokes the selected Wise provider and logs its response, while `r` reruns the original CLI tool | TypeScript, Ink, Wise | `src/config/provider-summary.ts`, `src/{commands/config.ts,ui/BrowseApp.tsx,ui/Footer.tsx,ai/provider.ts,cli.ts}` |
| 2026-10-10 | Added operational memory loop: read-only task `prepare`, human-approved/editable `close` proposals with prompt provenance, shared MCP retrieval and validated `save_decision` sources; expanded offline golden retrieval contract across five projects | TypeScript, SQLite, MCP, Vitest | `src/{commands/{prepare,close}.ts,context/index.ts,mcp/server.ts,cli.ts}`, `docs/{evals,plans}/`, `README.md`, `docs/ph-manual.md` |
| 2026-10-22 | Hardened memory promotion: approved batches and summary updates now commit atomically; `ph close` checks TTY before provider calls | TypeScript, SQLite, Vitest | `src/db/index.ts`, `src/commands/close.ts`, `src/mcp/server.ts`, `src/db/__tests__/phdb.test.ts`, `docs/specs/SPEC-016-operational-memory.md` |
| 2026-10-22 | Consolidated PH architecture: scoped feature growth pending three real workflow uses; MCP composition reduced to protocol wiring with domain-grouped handlers and shared task-context/promotion use cases; memory and archive SQL extracted behind the source-compatible PhDB facade | TypeScript, SQLite, MCP, Vitest | `src/knowledge/`, `src/mcp/`, `src/db/{memory,archive}-repository.ts`, `docs/specs/SPEC-017-architecture-consolidation.md`, `ROADMAP.md` |
| 2026-10-22 | Initial workspace experiment; superseded later the same day by a plain-text CLI and removal of the TUI | TypeScript, Ink, SQLite, Vitest | `src/ui/WorkHome.tsx` (removed), `src/cli.ts`, `README.md`, `CLAUDE.md`, `docs/ph-architecture-review.html` |
| 2026-10-22 | Simplified PH to a plain-text daily workflow; removed the Ink/React browser and dependencies, unified task retrieval under `context`, and made `close` default to three hours | TypeScript, SQLite | `src/cli.ts`, `src/commands/{context,close,search}.ts`, `src/ui/`, `package.json`, `README.md`, `docs/` |
| 2026-10-22 | Simplified daily use: added idempotent `ph setup` for native Claude/Codex/Gemini/OpenCode capture integrations; default guidance now makes capture automatic and keeps search as the primary recall command | TypeScript, Node.js, Vitest | `src/commands/setup.ts`, `src/cli.ts`, `README.md`, `docs/ph-manual.md` |
| 2026-10-22 | Improved actual search use: five current-project results by default, FTS relevance ordering, explicit `--all` scope, truthful setup status, and current-directory attribution for Codex hook imports | TypeScript, SQLite FTS5, Vitest | `src/commands/search.ts`, `src/db/index.ts`, `src/importer/codex.ts`, `hooks/codex/`, `src/commands/setup.ts` |
| 2026-10-24 | Closed network/capture/search findings with regression coverage for all six: database-scoped sync cursors, byte-bounded subpages, active-capture barrier and stale-marker recovery, invalid-URL isolation including real inline execution, one-time backfill from legacy data with blank rows, and joined project embedding loads | TypeScript, Node HTTP, SQLite FTS5, Vitest | `src/{server,sync,capture,runner,commands,db}`, `src/{commands,db,runner,sync}/__tests__`, `docs/specs/{SPEC-002,SPEC-005,SPEC-010,SPEC-019,SPEC-ISSUES}` |
| 2026-10-24 | Reassessed PH after network fixes; recorded remaining remote database identity, semantic vector provenance, and startup migration findings; aligned product and operational docs with source | TypeScript, Vitest, Markdown | `docs/specs/SPEC-ISSUES.md`, `docs/specs/{SPEC-002,SPEC-005,SPEC-010}`, `README.md`, `docs/ph-manual.md` |
