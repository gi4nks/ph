# ph — Prompt History and Project Memory

**Zero-friction capture, semantic search, project memory, and MCP-based knowledge retrieval for AI CLI tools.**

---

## 1. Overview

ph is a transparent observability and knowledge layer for AI CLI tools (Claude Code, Codex CLI, Gemini CLI, OpenCode, etc.). It automatically records every prompt+response into a local SQLite database with full-text search, semantic vector search, LLM-based analysis, Git context snapshots, session grouping, and an interactive TUI browser.

**Core principle:** ph captures conversations without changing the normal tool workflow. Optional analysis turns captured history into project summaries and memories that can be searched locally or requested by an MCP client. Capture and full-text search work without an LLM provider; analysis, embeddings, and semantic search require the configured provider.

### Key Features

- **Automatic capture** via hooks (Claude Code, Codex CLI, Gemini CLI, OpenCode plugin) or wrapper mode
- **Full-text search** (FTS5) and **semantic vector search** (Ollama embeddings, 768-dim via sqlite-vec)
- **LLM analysis** — role/tag/relevance classification, summary extraction, key insights, technical decisions
- **Project memory** — per-project accumulated knowledge with deduped insights and decisions
- **MCP server** — tools for agents to search memories, check project knowledge, get context
- **Interactive TUI** — browse, filter, edit, star, re-run, export prompts
- **Session grouping** — automatic conversation grouping with cohesion scoring
- **Git context** — records branch, modified files, and diff at capture time
- **Background analysis** — async LLM processing after each capture (optional)
- **Retention & archiving** — configurable auto-archive of old/low-relevance prompts
- **Remote sync** — push/pull prompt history across machines via HTTP server
- **Local-first storage** — the database stays on the configured machine unless optional remote sync is enabled; no telemetry is sent

---

## 2. Installation

```bash
# Via npm
npm install -g @gi4nks/ph

# From source
git clone git@github.com:gi4nks/ph.git
cd ph
npm install
npm run build
npm link
```

### Quick config

```bash
ph config set background-analysis true   # auto-analyze after each capture
ph config set analyze-provider ollama     # ollama (default) or gemini
ph config set ollama-model llama3.1:latest
```

---

## 3. Capture Modes

### 3a. Hook mode (recommended)

AI CLI tools invoke `ph log` automatically after each interaction.

**Claude Code** — `hooks/claude/ph-hook.sh`:
```bash
ln -sf $(pwd)/hooks/claude/ph-hook.sh ~/.claude/ph-hook.sh
# Add to ~/.claude/settings.json:
# "hooks": { "Stop": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "~/.claude/ph-hook.sh", "async": true }] }] }
```

**Gemini CLI** — `hooks/gemini/ph-hook.sh`:
```bash
ln -sf $(pwd)/hooks/gemini/ph-hook.sh ~/.gemini/ph-hook.sh
# Add to ~/.gemini/settings.json:
# "hooks": { "AfterAgent": [{ "hooks": [{ "type": "command", "command": "~/.gemini/ph-hook.sh" }] }] }
```

**OpenCode** — plugin at `hooks/opencode/ph-plugin.ts`:
```bash
./hooks/opencode/install.sh   # global install
```

**Codex CLI** — see [the Codex hook setup](../hooks/codex/README.md). The Stop
hook imports the active rollout transcript. To import existing sessions, run
`ph import codex --dry-run` and then `ph import codex`.

### 3b. Wrapper mode

```bash
ph claude "explain goroutines"
ph codex exec "explain goroutines"
ph gemini "refactor this code"
ph --ph-role debug --ph-tag auth claude "fix JWT expiration"
```

### 3c. Direct log

```bash
ph log --tool claude --prompt "your prompt" --response "response text"
echo '{"tool":"claude","prompt":"hi","response":"hello"}' | ph log --stdin
```

---

## 4. CLI Commands

| Command | Description |
|---------|-------------|
| `ph` (no args) | Open interactive TUI browser |
| `ph <tool> [args...]` | Wrapper mode — run tool + capture |
| `ph search [query]` | Full-text search prompts |
| `ph search --semantic <query>` | Semantic (vector) search |
| `ph search --archive` | Search archived prompts |
| `ph search -i <query>` | Open results in interactive TUI |
| `ph last [n]` | Show last N prompts |
| `ph context [query]` | Get RAG context for current project |
| `ph sessions` | Group prompts into work sessions |
| `ph timeline <project>` | Full chronological project history |
| `ph stats` | History statistics |
| `ph cluster -k 5` | K-means clustering on embeddings |
| `ph analyze` | LLM analysis of untagged prompts |
| `ph analyze-reusability` | Reusability scoring |
| `ph cleanup` | Remove useless prompts (length/duplicates) |
| `ph cleanup --retention` | Archive old/unqualified prompts per retention policy |
| `ph cleanup-reusability` | Cleanup by reusability score |
| `ph star <id>` | Toggle bookmark |
| `ph export <id>` | Export prompt (txt/json/md) |
| `ph import gemini|claude|opencode|codex` | Import from AI CLI history |
| `ph log --tool <name> ...` | Direct log (hook target) |
| `ph embed-all` | Generate embeddings for all prompts |
| `ph config get|set <key> <value>` | View/edit config |
| `ph vacuum` | Compact SQLite database |
| `ph memory-migrate` | Merge existing memories into project_summaries |
| `ph mcp` | Start MCP stdio server |
| `ph server --port 3001` | Start HTTP REST server |
| `ph remote push|pull|status` | Sync with remote ph server |
| `ph chat <tool> <prompt>` | Run tool with project context injected |
| `ph ollama-models` | List available Ollama models |

### Search options

```
-i / --interactive    Open in TUI browser
--tool <name>         Filter by tool
--project <name>      Filter by project
--language <lang>     Filter by language
--role <role>         Filter by role
--tag <tag>           Filter by tag
--starred             Show only starred
--semantic            Use semantic (vector) search
--archive             Search archived prompts
--since YYYY-MM-DD    Start date
--until YYYY-MM-DD    End date
--limit <n>           Max results (default 50)
--top                 Quality >= 8
--min-quality <n>     Min quality (0-10)
--min-relevance <n>   Min relevance (0-10)
--full                Show full prompt text
```

### Context options

```
--project <name>      Project name (default: auto-detect)
--limit <n>           Max results (default 5)
--prompts-only        Skip project knowledge, show only prompts
--memories-only       Skip prompts, show only project knowledge
--verbose             Include full prompt text
```

### Sessions options

```
--gap-hours <n>       Hours gap to split sessions (default 2)
--limit <n>           Max sessions (default 20)
--min-size <n>        Min prompts per session (default 1)
--no-cohesion         Skip semantic cohesion computation
--export <n>          Export session N as markdown
```

### Cluster options

```
-k <number>           Number of clusters (default 5)
--limit <n>           Max prompts per cluster to show (default 3)
```

---

## 5. TUI Keybindings

| Key | Action |
|-----|--------|
| `Up` / `Down`, `Page Up` / `Page Down` | Navigate list |
| `Tab` | Switch pane (wide mode) |
| `1`, `2`, `3` | Switch prompt/response/memory tab |
| `y` | Copy to clipboard |
| `s` | Toggle star |
| `e` | Edit metadata |
| `r` | Rerun prompt (edit before launch) |
| `Shift+C` | Chat mode: launch tool with project context |
| `x` | Delete entry |
| `/` | Search |
| `o` | Settings panel (toggle auto-analysis, view config) |
| `f` | Filter panel (flat list, Enter toggle, letter jump) |
| `c` | Clear all filters |
| `q` / `Escape` | Quit / back |

### TUI components

- **SearchBar** — always visible spotlight bar at top
- **FilterPanel** — flat scrollable list of filter options with counts `[N]`, toggle with Enter, jump by letter
- **SettingsView** — config viewer/editor (auto-analysis toggle, ollama URL/model, filters)
- **PreviewPane** — three tabs (prompt/response/memory). Memory tab shows project-level knowledge
- **ListEntry** — role marker, analysis status, star, Q/R badges, optional summary line
- **Footer** — context-sensitive hints (shows `C:chat` only when entry has project)

---

## 6. Project Memory System

ph maintains two levels of per-project knowledge:

### 6a. `project_summaries` (curated, 1 row per project)

Accumulated knowledge with deduped insights and decisions. Updated on every analysis. Primary source for MCP tools.

```bash
# View accumulated project knowledge
ph context --project myproject

# Via MCP (for AI agents)
# get_project_summary(project: "myproject")
```

### 6b. `memories` (append-only timeline)

Full chronological history of every analysis run. Preserved for detailed audit.

### Memory migration

If you have existing data from before the evolution phases:

```bash
ph memory-migrate   # one-time: merge all memories into project_summaries
```

---

## 7. Retention & Archiving

Configurable auto-archiving to keep the database lean:

```bash
# Configure
ph config set retentionDays 90            # archive prompts older than 90 days
ph config set retentionMinRelevance 3     # prompts below this relevance archived first
ph config set retentionMinStarred true    # starred prompts never archived
ph config set retentionMinAnalyzed true   # analyzed prompts never archived

# Run retention cleanup
ph cleanup --retention                    # archive matching prompts
ph cleanup --retention --dry-run          # preview only

# Search archived prompts
ph search --archive

# Auto-purge: entries older than 2x retentionDays are deleted during cleanup
```

---

## 8. Background Analysis

When enabled, every `ph log` automatically spawns a detached child process that analyzes the new entry (role, tags, relevance, summary, key insights, technical decisions).

```bash
ph config set background-analysis true
```

Analysis uses Ollama by default (requires `ollama serve` running). Configure:

```bash
ph config set analyze-provider gemini     # use Gemini instead
ph config set gemini-api-key "YOUR_KEY"
ph config set ollama-model llama3.1:latest
ph config set ollama-embed-model nomic-embed-text-v2-moe
```

---

## 9. MCP Server

ph exposes an MCP (Model Context Protocol) server over stdio for AI agents:

```bash
ph mcp
```

### Available tools

| Tool | Description |
|------|-------------|
| `search_project_memory` | Semantic search + fallback to project_summaries |
| `get_project_context` | Merged summary + recent memories + recent prompts |
| `get_project_summary` | Accumulated key insights and technical decisions |
| `check_project_knowledge` | Before implementing: checks memories + prompts for existing work |
| `save_decision` | Persist an architectural decision to memory + summaries |
| `search_prompts` | Full-text search over prompt history |
| `get_prompt` | Full details by ID |
| `search_prompts_semantic` | Vector search over prompts |
| `get_project_timeline` | Full chronological project history |
| `get_project_diff` | Compare project state between dates |
| `list_prompts` | Paginated prompt listing |

---

## 10. HTTP Server & Remote Sync

Share prompt history across machines:

```bash
# Start server
ph server --port 3001 --host 0.0.0.0

# From another machine
ph config set remote-url http://server-ip:3001
ph remote push      # send local unsynced prompts
ph remote pull      # fetch remote prompts
ph remote status    # show sync state
```

Every `ph log` auto-pushes to remote if configured (fire-and-forget, never blocks).

---

## 11. Database

**Location:** `~/.prompt_history.db` (configurable via `ph config set db-path`)

**Tables:**

| Table | Purpose |
|-------|---------|
| `prompts` | Main prompt+response storage with FTS5 index |
| `prompts_archive` | Archived (retention-aged) prompts |
| `memories` | Append-only per-project analysis timeline |
| `project_summaries` | Single curated row per project with merged knowledge |
| `vec_embeddings` | Vector embeddings (768-dim float, sqlite-vec) |
| `embeddings` | Legacy BLOB embeddings (migrated on connect) |

**Maintenance:**

```bash
ph vacuum              # compact DB
ph cleanup             # remove short/trivial/duplicate prompts
ph cleanup --retention # archive per retention policy
ph embed-all           # (re)generate all embeddings
```

---

## 12. Filter Pipeline

Before saving, ph filters out:

- Prompts shorter than `filterMinLength` (default 15 chars)
- Non-printable content
- Trivial patterns (single chars, common noise)
- Exact duplicates (within last 7 days)
- Low-relevance prompts (when `--min-relevance` is set)

Configure:

```bash
ph config set filter-min-length 20
ph config set filter-min-relevance 3
```

---

## 13. Configuration (`~/.ph_config.json`)

| Key | Default | Description |
|-----|---------|-------------|
| `dbPath` | `~/.prompt_history.db` | SQLite database path |
| `analyzeProvider` | `ollama` | LLM provider: `ollama` or `gemini` |
| `ollamaUrl` | `http://localhost:11434` | Ollama server URL |
| `ollamaModel` | `llama3.1:latest` | Analysis model |
| `ollamaEmbedModel` | `nomic-embed-text-v2-moe` | Embedding model |
| `geminiApiKey` | — | Gemini API key |
| `backgroundAnalysis` | `false` | Auto-analyze after each capture |
| `filterMinLength` | `15` | Min prompt length to keep |
| `filterMinRelevance` | `3` | Min relevance to keep (0=disable) |
| `retentionDays` | `90` | Auto-archive after N days |
| `retentionMinStarred` | `true` | Keep starred prompts |
| `retentionMinAnalyzed` | `true` | Keep analyzed prompts |
| `retentionMinRelevance` | `3` | Archive prompts below this relevance |
| `remoteUrl` | — | Remote ph server URL (or `PH_REMOTE_URL` env) |
| `remoteApiKey` | — | Remote server API key |
| `remoteLastPush` | — | Timestamp of last successful push |
| `remoteLastPull` | — | Timestamp of last successful pull |

---

## 14. Architecture

```
Hook/Import → ph log → prompts table (FTS5 indexed)
                              ↓
                    Background analysis (optional)
                              ↓
              ┌────────────────┴────────────────┐
              ↓                                 ↓
        memories (append-only,           project_summaries
        with TTL)                        (1 row per project,
                                          merged + deduped)
              ↓                                 ↓
        ph cleanup --retention            MCP tools read
        → prompts_archive                 from here
```

### File layout

```
src/
  cli.ts              # Entry point (~80 lines), switch dispatch
  types.ts            # Core types (PromptEntry, MemoryEntry, ProjectSummary, etc.)
  db/index.ts         # PhDB public SQLite adapter
  db/semantic-index.ts # Vector encoding, storage, and nearest-neighbor search
  context/index.ts    # Shared project-context retrieval and rendering
  capture/index.ts    # Shared capture-record normalization
  commands/           # One module per CLI command
  analyzer/           # LLM analysis (role/tag/relevance/summary/insights)
  embedding/          # Ollama embedding generation
  filter/             # Capture-time filter pipeline
  mcp/server.ts       # MCP stdio server
  server/index.ts     # HTTP REST server (zero deps)
  ui/                 # React/Ink TUI, including extracted filter policy and panel
  importer/           # Gemini/Claude/OpenCode/Codex history importers
hooks/                # Shell scripts and plugins for AI tools
```

---

## 15. Importing Existing History

```bash
# Import from Claude Code
ph import claude --analyze

# Import from Gemini CLI
ph import gemini --filter

# Import from OpenCode
ph import opencode

# Import from Codex CLI
ph import codex --dry-run
ph import codex

# Options:
#   --analyze    run LLM analysis on imported prompts
#   --filter     apply capture-time filters
#   --dry-run    preview without importing
```

---

## 16. Versioning and Releases

Use Conventional Commits to describe changes: `feat:` requests a minor release,
`fix:` requests a patch release, and `BREAKING CHANGE:` requests a major release.
The GitHub Actions workflow runs `semantic-release` on pushes to `main`, updates
release metadata, publishes to npm, and creates a GitHub release.

The Make targets `make release-patch`, `make release-minor`, and
`make release-major` increment `package.json` and `package-lock.json` locally.
They do not commit, tag, or publish. The automated release workflow determines
the actual published version from commits since its most recent release tag.

---

## Repository

[https://github.com/gi4nks/ph](https://github.com/gi4nks/ph)
