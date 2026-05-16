# AGENTS.md — Project Knowledge Base for AI Agents

## Session Progress

### Goal
Remote sync infrastructure: HTTP server for cross-laptop prompt history sharing, with offline-first local SQLite + background push/pull to a remote ph server.

### Completed
- **Phase 0**: `cli.ts` ~1500→~80 lines; 19 command handlers → `src/commands/*.ts`
- **Phase 1**: `sqlite-vec` integrated, `vec_embeddings` + `memories` tables, auto-migration from old BLOB embeddings
- **Phase 2.1–2.3**: `ANALYSIS_PROMPT` requests `summary`/`key_insights`/`technical_decisions`; `analyzeAll`/`_bg-analyze` populate `memories` (append-only); `ph context` outputs memories + prompts in markdown
- **Phase 3.2**: MCP tools `search_project_memory`, `get_project_context`, `get_project_summary`
- **Phase 4.2–4.3**: `C` (Shift+C) in TUI launches tool with project context; `ph chat <tool> <prompt>` injects RAG context
- **TUI**: FilterPanel redesigned (flat list, counts `[N]`, Enter toggle, letter-jump); `ListEntry` role-colored bar `│`, summary line, analysis indicator `●/○`, Q/R badges; `SearchBar` always visible; `Footer` context-sensitive hints; session separators `╌╌ date ╌╌`
- **Memory**: `upsertProjectMemory` is append-only → full timeline per project
- **Docs**: `AGENTS.md` fully rewritten; `ROADMAP_RAG.md` updated with completed phases checked
- **OpenCode importer**: `src/importer/opencode.ts` reads from SQLite DB (`~/.local/share/opencode/opencode.db`), paired 186 user messages with responses, imported 151 prompts into ph after dedup
- **OpenCode plugin**: `hooks/opencode/ph-plugin.ts` — real-time capture via OpenCode plugin hooks (`chat.message` + `experimental.text.complete`). Pairs user prompts with streamed assistant responses, calls `ph log` in background. Install script at `hooks/opencode/install.sh`.
- **MCP prompt history tools**: `search_prompts`, `get_prompt`, `search_prompts_semantic` added to `src/mcp/server.ts` — full-text search, by-ID lookup, and vector search over raw prompt history
- **HTTP server (`ph server`)**: `src/server/index.ts` — lightweight REST API using Node `http` module (no deps). Endpoints: `/health`, `/api/prompts/search`, `/api/prompts/by-id`, `/api/prompts/semantic`, `/api/sync/push`, `/api/sync/pull`, `/api/memories/search`, `/api/memories/summary`, `/api/stats`. CORS enabled. Configurable port/host via `--port`/`--host`.
- **Remote sync (`ph remote`)**: `src/commands/remote.ts` — `push` (sends unsynced local prompts to remote by timestamp), `pull` (fetches remote prompts since last pull, dedup by `sync_hash`), `status` (shows sync state). Dedup via sha256 of `tool|prompt|response` stored in metadata as `sync_hash`.
- **Background push on log**: `src/commands/log.ts` — after each `ph log`, fire-and-forget push to remote if configured (no blocking).
- **Env/config remote URL**: `PH_REMOTE_URL` env var takes precedence over `ph config set remoteUrl`. Config comment uses generic placeholder — no hardcoded server names.
- **semantic-release**: Replaced `standard-version` with `semantic-release` for automated CI/CD. Release workflow runs on push to `main`, bumps version via conventional commits, publishes to npm with OIDC provenance.
- **OIDC trusted publishing**: Package published with provenance attestation via GitHub Actions (`id-token: write`). Publisher identity: `GitHub Actions <npm-oidc-no-reply@github.com>`.
- **Ubuntu server setup**: Added systemd service template for `ph server` as a remote sync daemon.

### Next Steps
- Task 2.4: git state tracking to avoid duplicate memories when project hasn't changed
- Optionally fix pre-existing React lint errors in `BrowseApp.tsx:198` / `PreviewPane.tsx:79,84`

### Known Issues
- 5 pre-existing lint issues (3 React lint in `BrowseApp`/`PreviewPane`, 2 `any` in `mcp/server.ts`) — no regressions
- Build passes (`npm run build` → ESM dist, ~170 KB)

## Project Overview

**`ph`** (Prompt History & Analysis) is a transparent observability layer for AI CLI tools (Claude Code, Gemini CLI, etc.). It automatically records every prompt+response into a local SQLite database with full-text search, semantic vector search, LLM-based analysis (role/tag/relevance classification), Git context snapshots, session grouping, and an interactive TUI browser.

Three modes of capture:
- **Wrapper mode**: `ph claude "explain goroutines"` — wraps a CLI tool transparently
- **Hook mode**: AI CLI tools invoke `ph-hook.sh` scripts post-session (zero friction)
- **Direct**: `ph log --tool claude --prompt "..." --response "..."` or via stdin JSON

## Directory Layout

```
src/
  cli.ts              # Entry point (~80 lines) — switch dispatch to command modules
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
    import.ts         # ph import — Gemini/Claude import
    log.ts            # ph log — direct logging (hook target)
    embed-all.ts      # ph embed-all — batch embedding
    config.ts         # ph config — get/set config
    vacuum.ts         # ph vacuum — DB compaction
    background-analyze.ts  # internal _bg-analyze worker
    chat.ts           # ph chat — context-injected tool wrapper
    wrap.ts           # ph <tool> — wrapper mode entry
  ai/
    provider.ts       # LLMProvider interface + factory
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
  ui/
    BrowseApp.tsx     # Main TUI application (React/Ink)
    Footer.tsx        # TUI footer
    Header.tsx        # TUI header
    ListEntry.tsx     # Entry list component
    PreviewPane.tsx   # Detail/preview pane
    SearchBar.tsx     # Search bar
    themes.ts         # Color themes
  utils/
    extractTopic.ts   # Title extraction from prompt text
hooks/
  claude/ph-hook.sh   # Claude Code Stop hook (shell script)
  gemini/ph-hook.sh   # Gemini CLI AfterAgent hook (shell script)
docs/                 # Documentation files
  ph-manual.md        # Comprehensive architecture guide
dist/                 # Build output (gitignored)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.9 ESM (`"type": "module"`) |
| Runtime | Node.js 20+ |
| Build | `tsup` 8.5 — `src/cli.ts` → `dist/cli.js` |
| DB | SQLite via `better-sqlite3` 12.8 (WAL mode, FTS5) |
| Vector | `sqlite-vec` 0.1 (native `vec0`, 768-dim) |
| TUI | `ink` 6.8 + `react` 19.2 |
| PTY | `@lydell/node-pty` 1.2 |
| MCP | `@modelcontextprotocol/sdk` 1.29 |
| Validation | `zod` 4.3 |
| Linting | ESLint 9 + TypeScript + React |
| Testing | `vitest` 4.1 |
| Release | `semantic-release` 25 (conventional commits) |
| Dev Runner | `tsx` 4.21 |

## Commands

| Command | Function |
|---------|----------|
| (no args) | Open interactive TUI browser |
| `<tool>` | Wrapper mode — run tool + capture |
| `search` | Full-text or semantic search |
| `context` | RAG context for current project |
| `last` | Show last N prompts |
| `sessions` | Group prompts into work sessions |
| `stats` | History statistics |
| `cluster` | K-means clustering on embeddings |
| `analyze` | LLM analysis of untagged prompts |
| `analyze-reusability` | Reusability scoring |
| `cleanup-reusability` | Cleanup by reusability score |
| `star` | Toggle bookmark |
| `export` | Export prompt (txt/json/md) |
| `import` | Import from Gemini/Claude/OpenCode history (`--analyze` runs inline LLM analysis) |
| `log` | Log prompt+response (used by hooks) |
| `embed-all` | Generate embeddings for all prompts |
| `cleanup` | Rule-based cleanup (length/age) |
| `vacuum` | Compact SQLite database |
| `config` | Get/set config values |
| `mcp` | Start MCP stdio server |
| `server` | Start HTTP REST server (`--port`, `--host`) |
| `remote` | Sync with remote ph server: `push`, `pull`, `status` |
| `ollama-models` | List Ollama models |
| `chat` | Context-injected tool wrapper |
| `_bg-analyze` | Internal: background analysis worker |

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
  analyzeProvider?: 'ollama' | 'gemini';  // default: ollama
  ollamaUrl?: string;                 // default: http://localhost:11434
  ollamaModel?: string;               // default: llama3.1:latest
  ollamaEmbedModel?: string;          // default: nomic-embed-text-v2-moe
  filterMinLength?: number;           // default: 15
  filterMinRelevance?: number;        // default: 3
  backgroundAnalysis?: boolean;       // default: false — runs _bg-analyze after each ph log
  remoteUrl?: string;                 // HTTP URL of remote ph server (or set PH_REMOTE_URL env)
  remoteApiKey?: string;              // optional API key for remote server
  remoteLastPull?: string;            // ISO timestamp of last successful pull
}
```

### Enabling Auto-Analysis

```bash
ph config set background-analysis true
```

Dopo ogni `ph log ...` o hook invocation, partirà automaticamente l'analisi in background e le memory entries si accumuleranno.

## TUI Keybindings

| Key | Action |
|-----|--------|
| `↑↓` / `PgUp` `PgDn` | Navigate list |
| `Tab` | Switch pane (wide mode) |
| `1` `2` `3` | Switch prompt/response/memory tab |
| `y` | Copy to clipboard |
| `s` | Toggle star |
| `e` | Edit metadata |
| `r` | Rerun prompt (edit before launch) |
| `C` (Shift) | Chat mode: launch tool with project context injected |
| `x` | Delete entry |
| `/` | Search |
| `o` | Settings panel (toggle auto-analysis, view config) |
| `f` | Filter panel (flat list with counts, Enter toggle, letter jump) |
| `c` | Clear all filters |
| `q` / `ESC` | Quit / back |

## TUI Components

| Component | File | Features |
|-----------|------|----------|
| `BrowseApp` | `src/ui/BrowseApp.tsx` | Main app, list+detail views, filter panel, session separators (`╌╌ date ╌╌`) |
| `ListEntry` | `src/ui/ListEntry.tsx` | Role-colored bar `│`, analysis indicator `●/○`, star, Q/R badges, optional summary line |
| `PreviewPane` | `src/ui/PreviewPane.tsx` | Three tabs (prompt/response/memory). Memory tab shows project-level knowledge from `memories` table |
| `SearchBar` | `src/ui/SearchBar.tsx` | Always visible spotlight bar, activates on `/` |
| `Footer` | `src/ui/Footer.tsx` | Context-sensitive hints (shows `C:chat` only when entry has project, `Tab:pane` only in wide mode) |
| `FilterPanel` | `src/ui/BrowseApp.tsx` | Flat scrollable list of all filter options with counts `[N]`, toggle with Enter, jump to category by letter |
| `SettingsView` | `src/ui/BrowseApp.tsx` | Config viewer/editor (toggle auto-analysis, view/edit ollama URL, model, filters) |
| `DetailView` | `src/ui/BrowseApp.tsx` | Full-screen detail (narrow mode), same three tabs as PreviewPane |

## Key Architecture Patterns

- **ESM only**: all imports use `.js` extension
- **Manual arg parsing**: `cli.ts``s `main()` uses `parseFlags()` — no commander/yargs
- **Commands in `src/commands/`**: each command (`search`, `context`, `analyze`, etc.) has its own file exporting `cmdXxx(db, cfg?, args?)`, dispatched via switch in `cli.ts`
- **`ph chat`**: wrapper that auto-injects project context (memories + recent prompts) before forwarding to the tool
- **Background analysis**: spawns detached child process via `spawnBackgroundAnalysis()` — never blocks
- **Auto-analysis**: enabled via `ph config set background-analysis true` — runs `_bg-analyze` after each `ph log` capture
- **Multiple memories**: each analysis creates a NEW entry in `memories` table (append-only), preserving full timeline per project instead of overwriting
- **Memory pipeline**: analysis → `upsertProjectMemory()` creates new memory entry with `key_insights` + `technical_decisions` per project
- **`ph context`**: outputs both project-level knowledge (from `memories`) + recent prompt interactions (markdown, pipe-ready)
- **Import with analysis**: `ph import gemini --analyze` runs inline LLM analysis on imported prompts (supports `gemini`, `claude`, `opencode`)
- **MCP server**: exposes `search_project_memory`, `get_project_context` (with memories), `get_project_summary` tools
- **Hooks**: shell scripts in `hooks/<tool>/ph-hook.sh`, invoked by AI CLI tools, pipe JSON to `ph log`
- **OpenCode importer**: reads from the SQLite DB at `~/.local/share/opencode/opencode.db` — queries `session`, `message`, and `part` tables; assistant messages link to user via `parentID` in `message.data` JSON
- **Metadata merging**: `mergeMetadata()` in `analyzer/index.ts` merges new analysis with existing metadata (preserves manual fields unless force=true)
- **Filter pipeline**: 4 checks (too short, non-printable, trivial pattern, exact duplicate) + optional relevance filter
- **Project detection**: walks up directory tree checking `.git`, `go.mod`, `package.json`, `Cargo.toml`, etc.
- **Remote sync**: `ph server` starts HTTP REST API (Node `http` module, no deps). Endpoints for prompt search, CRUD, and sync. `ph remote push` sends unsynced prompts to remote (tracked by `remoteLastPush` timestamp in config). `ph remote pull` fetches remote prompts since `remoteLastPull` and merges locally. Dedup via `sync_hash` (sha256 of `tool|prompt|response`) stored in metadata JSON.
- **Background push**: after each `ph log`, if `PH_REMOTE_URL` env or `remoteUrl` config is set, fire-and-forget push to remote (`.catch(() => {})` — never blocks or crashes).
- **Env overrides**: `PH_REMOTE_URL` env var takes precedence over config file `remoteUrl`. No server names hardcoded in code.

## Important Files for Quick Reference

- `src/cli.ts` — main entry (~80 lines), switch dispatch
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
- `src/commands/log.ts` — `ph log` with background remote push
- `src/importer/opencode.ts` — OpenCode history importer
- `hooks/claude/ph-hook.sh` — Claude Code hook
- `hooks/gemini/ph-hook.sh` — Gemini CLI hook
- `docs/ph-manual.md` — comprehensive architecture guide
