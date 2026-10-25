# PH — User Manual

**Capture AI coding sessions, find earlier work, and carry durable project context forward.**

---

## 1. Overview

PH is a local-first history and project-context tool for AI CLI work. It records interactions through native hooks or by wrapping a tool, then lets you search history and retrieve project context from the terminal.

**Core principle:** Keep using your coding tools normally. PH captures their interactions and makes them searchable. Optional analysis adds a summary and tags to each interaction. Local project memories still require review through `ph close` or an explicit MCP `save_decision`. When a memory hub is configured, a separate background process can automatically save directly evidenced, non-sensitive work preferences and project decisions to that hub. This automatic path is triggered by capture; it does not depend on the coding agent choosing to call an MCP tool. Capture and full-text search work without an LLM provider; analysis, embeddings, and automatic memory extraction use the configured inference provider.

### Key Features

- **Automatic capture** via hooks (Claude Code, Codex CLI, Gemini CLI, OpenCode plugin) or wrapper mode
- **Full-text search** (FTS5) and **semantic vector search** (Ollama embeddings, 768-dim via sqlite-vec)
- **LLM analysis** — role/tag/relevance classification, summary extraction, key insights, technical decisions
- **Project memory** — per-project accumulated knowledge with deduped insights and decisions
- **Automatic shared memory** — source-linked work preferences and project decisions from captured coding-agent interactions
- **MCP server** — tools for agents to search memories, check project knowledge, get context
- **Plain-text CLI** — the everyday interface is a small set of terminal commands
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
ph config set analyze-provider ollama     # ollama (default), gemini, openrouter, or mlx-serve
ph config set ollama-model llama3.1:latest
```

To enable automatic shared-memory capture, configure the hub separately from remote prompt-history sync:

```bash
ph config set memory-hub-url https://memory.example
ph config set memory-hub-api-key   # PH prompts for the key without echoing it
ph status
```

Automatic memory capture is enabled when the hub URL and key are configured unless you disable it with `ph config set memory-auto-capture false`. `background-analysis` is a separate feature and does not control memory extraction.

---

## 3. Capture Modes

### 3a. Hook mode (recommended)

PH's native integrations capture completed interactions. Most hooks send the captured exchange through `ph log`; the Codex Stop hook imports the active rollout transcript with `ph import codex --file ...`. PH also supports wrapper mode and direct logging.

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

## 4. Everyday Commands

| Command | Description |
|---------|-------------|
| `ph` | Print the short usage guide |
| `ph setup` | Connect installed Claude Code, Codex CLI, Gemini CLI, and OpenCode for automatic capture |
| `ph <tool> [args...]` | Run an AI CLI tool and capture the interaction |
| `ph search <query>` | Find earlier work in the current project (five matches by default) |
| `ph show <id>` | Inspect the complete prompt, response, capture metadata, and analysis |
| `ph show <id> --json` | Print the complete interaction as JSON |
| `ph context "task"` | Retrieve project knowledge and related prompts |
| `ph close` | Review the last three hours and approve useful project knowledge |
| `ph status` | Check recent capture, analysis, automatic-memory, and sync status |
| `ph memory search <query>` | Search shared memories in the configured hub |
| `ph memory undo <interaction-id>` | Reversibly forget automatic memories from one interaction |

`ph setup` is the recommended first step for everyday use. It detects installed supported tools (Claude Code, Codex CLI, Gemini CLI, and OpenCode), installs their native capture integrations, preserves existing settings, and reports whether each integration was installed or already configured. Pass tool names to choose explicitly. After setup, keep using your AI CLI normally; `ph search "query"` is the main command for retrieving earlier work. `ph <tool>` remains as a wrapper alternative.

When the memory hub is configured, supported coding-agent captures also start memory extraction in the background. You do not need to invoke `ph memory save` or an MCP save tool for this automatic path.

`ph search "query"` searches the project detected from the current directory and returns five matches by default, ordered by text relevance. Use `--limit <n>` to show more, or `--all` to search across every project. When no project can be detected, PH searches all saved work and labels that scope. Searches with no current-project matches explain how to broaden the search.

`ph prepare "task"` remains as a compatibility alias for task-aware `ph context`.
`ph browse` is a compatibility alias for a plain-text list of recent interactions.
Use `ph help --all` for maintenance and integration commands, including `ph status` for recent capture and background-work state.

## 4a. Advanced Command Reference

| Command | Description |
|---------|-------------|
| `ph` (no args) | Print the short everyday-use guide |
| `ph <tool> [args...]` | Wrapper mode — run tool + capture |
| `ph search [query]` | Full-text search (current project, five matches by default) |
| `ph search --semantic <query>` | Semantic (vector) search |
| `ph search --archive` | Search archived prompts |
| `ph last [n]` | Show last N prompts |
| `ph context [task]` | Retrieve task-aware project context; works without semantic embeddings |
| `ph prepare "<task>"` | Compatibility alias for task-aware context retrieval |
| `ph browse` | Compatibility alias for recent text results |
| `ph close [--since 3h]` | Review recent work and propose knowledge for explicit approval |
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
| `ph export <id> [--format txt|json|md] [--archive]` | Export a complete interaction |
| `ph status` | Show recent capture, analysis, automatic-memory, and remote-push state without content |
| `ph import gemini|claude|opencode|codex` | Import from AI CLI history |
| `ph log --tool <name> ...` | Direct log (hook target) |
| `ph embed-all` | Generate embeddings for prompts without vectors |
| `ph config get|set <key> <value>` | View/edit config |
| `ph vacuum` | Compact SQLite database |
| `ph memory-migrate` | Merge existing memories into project_summaries |
| `ph memory <action>` | Save, search, show, forget, restore, undo, or retry shared memories |
| `ph mcp` | Start MCP stdio server |
| `ph server --port 3001` | Start HTTP REST server |
| `ph remote push|pull|status` | Sync with remote ph server |
| `ph chat <tool> <prompt>` | Run tool with project context injected |
| `ph ollama-models` | List available Ollama models |

### Search options

```
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
--limit <n>           Max results (default 5)
--all                 Search across all projects instead of the current project
--top                 Quality >= 8
--min-quality <n>     Min quality (0-10)
--min-relevance <n>   Min relevance (0-10)
--full                Show full prompt and response text
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

## 5. Project Memory System

ph maintains two levels of per-project knowledge:

### 5a. `project_summaries` (curated, 1 row per project)

Accumulated, explicitly promoted knowledge with deduped insights and decisions. Updated by approved `close` proposals, MCP `save_decision`, and legacy migration; automatic analysis does not write here.

```bash
# View accumulated project knowledge
ph context --project myproject

# Via MCP (for AI agents)
# get_project_summary(project: "myproject")
```

### 5b. `memories` (append-only timeline)

Legacy append-only project knowledge records retained for detailed audit. New automatic analysis results stay on their source interaction instead of creating memory rows.

### Operational workflow: retrieve, work, review

```bash
# Read-only task context; project auto-detected from the current directory
ph context "add Wise provider" --limit 5 --budget 3500

# Inspect the selection without calling an LLM
ph close --dry-run --since 3h

# Generate knowledge proposals; approve, edit, skip, or quit each one
ph close --since 3h
ph close --from 1670 --to 1682 --project ph
```

`context` uses the task as a semantic retrieval query and prints source-linked prompt and memory excerpts. If Ollama embeddings are unavailable, it labels the fallback to recent project context. Retrieval never writes to SQLite. `prepare` remains an alias for compatibility. The character budget limits retrieved content; when the source list itself is larger than the budget, source IDs take precedence and the output can exceed the requested budget.

`close` selects prompt/response pairs within one project, displays them before generation, and asks the configured analysis provider for durable proposals. It checks for a terminal before making that provider call. Each accepted proposal creates an append-only memory tied to its source prompt IDs; the approved batch and summary updates are committed in one SQLite transaction. A persistence failure rolls back the whole batch. Provider errors, malformed output, dry-run, skipping, and quitting do not promote unapproved knowledge.

MCP `check_project_knowledge` uses the same retrieval and rendering boundary. MCP `save_decision` accepts optional `promptIds` and rejects missing or cross-project sources.

### Memory migration

If you have existing data from before the evolution phases:

```bash
ph memory-migrate   # one-time: merge all memories into project_summaries
```

---

## 6. Retention & Archiving

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

## 7. Background Analysis

When enabled, every `ph log` marks analysis pending and starts a detached child process that adds role, tags, relevance, summary, key insights, and technical decisions to the interaction. It does not create project memories or summaries. `ph status` shows pending, complete, or safe failure state. Remote push status is shown when configured.

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

OpenRouter and MLX-Serve generation use `@gi4nks/wise`:

```bash
# OpenRouter: credentials stay in the environment; model IDs keep provider/model.
export OPENROUTER_API_KEY="your_openrouter_api_key"
ph models openrouter
ph config set openrouter-api-key  # hidden prompt; or keep using the environment
ph config set analyze-provider openrouter
ph config set openrouter-model "provider/model-id"
ph config show                    # provider settings with credentials redacted
ph analyze

# Optional: forward the configured remote inference service to localhost.
ssh -N -L 11234:127.0.0.1:11234 user@inference-host
```

```bash
# In the terminal where you run ph:
ph models mlx-serve
ph config set analyze-provider mlx-serve
ph config set mlx-serve-model "exact-model-id-from-server"
ph analyze
```

MLX-Serve defaults to `http://127.0.0.1:11234/v1`. Override it with
`MLX_SERVE_BASE_URL` or `ph config set mlx-serve-url <url>`. Set
`MLX_SERVE_API_KEY` if the server requires auth; `GLB_OMLX_API_KEY` is also
accepted for existing setups. Alternatively run `ph config set mlx-serve-api-key`
to enter it without echoing it in the terminal. `ph config show` redacts
credentials. `ph models mlx-serve` marks entries `[loaded]` or `[unloaded]`.

---

## 8. MCP Server

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
| `search_shared_memory` | Search non-sensitive work/project memories from the configured memory hub |
| `save_shared_memory` | Save a durable non-sensitive work/project memory with a source reference |
| `get_project_timeline` | Full chronological project history |
| `get_project_diff` | Compare project state between dates |
| `list_prompts` | Paginated prompt listing |

---

## 9. HTTP Server & Remote Sync

Share prompt history across machines:

```bash
# Configure the required server key, then start on loopback
ph config set remote-api-key "$PH_REMOTE_API_KEY"
ph server --port 3001

# On the server, expose the listener only on a protected interface and put TLS
# in front of it before using the endpoint across an untrusted network.
# On each client, set the server URL and the same key:
ph config set remote-api-key "$PH_REMOTE_API_KEY"
ph config set remote-url http://server-ip:3001
ph remote push      # resumable ID-based sync
ph remote pull      # resumable ID-based sync
ph remote status    # show sync state
```

The server requires a key before it starts, binds to `127.0.0.1` by default, and exposes only a status value at public `/health`. All data routes require Bearer authentication. Push and pull cursors are scoped to the remote target and the local database UUID. Push pages are split to stay below the 32 MiB request-body limit; interrupted pages can be retried safely. Bulk push waits at a live wrapper record and continues after the response is saved. `ph log` and both wrapper modes push after capture; requests time out after five seconds so an unavailable server cannot hang the command indefinitely. An invalid optional remote URL marks sync failed while the interaction remains saved locally and the wrapped CLI still runs. Current limitation: replacing the remote database behind the same URL is not detected, and last-push/pull status times are global across targets.

### PH memory hub

The memory hub is separate from remote prompt-history sync. Configuring it does not upload raw prompts or responses to the hub and does not enable `ph remote push`.

```bash
ph config set memory-hub-url https://memory.example
ph config set memory-hub-api-key   # Enter the key at the hidden prompt
ph status
```

When the hub URL and key are configured, automatic memory capture is enabled for supported coding CLIs unless you turn it off. PH extracts in the background after each completed Claude Code, Codex CLI, Gemini CLI, or OpenCode interaction. Codex capture also works through its active-transcript import hook. This does not depend on the agent choosing to call an MCP save tool.

PH asks the configured inference provider to extract at most two durable memories. Each must be a work preference or project decision, have an exact supporting quote in the user prompt, and pass sensitivity checks. PH does not automatically write personal-scope memories. The provider receives the captured prompt and response, each limited to 4,000 characters. The hub receives only the derived memory and its prompt source reference. If the selected provider is hosted, the bounded interaction is sent to that provider; choose a private inference service if that is not acceptable. Sensitive-data classification is imperfect, so these checks reduce risk but cannot guarantee that every sensitive statement is detected.

Use these commands to inspect or manage shared memories:

```bash
ph memory save "Prefers concise technical explanations" --scope work --kind preference
ph memory search "technical explanations"
ph memory show <memory-id>
ph memory forget <memory-id>
ph memory restore <memory-id>
ph memory undo <interaction-id>
ph memory retry <interaction-id>
```

`ph status` shows automatic-memory state for recent interactions (`pending`, `complete`, `empty`, or `failed`). `ph memory undo <interaction-id>` reversibly forgets all automatic memories tied to that interaction and prints their IDs; use `ph memory restore <memory-id>` to restore one. Use `ph memory retry <interaction-id>` after an inference or hub failure. Set `ph config set memory-auto-capture false` to disable extraction, or `true` to enable it again.

Sensitive memories require an explicit command, for example `printf '%s' 'Sensitive fact' | ph memory save --scope personal --sensitive`. Sensitive results are excluded from search and `ph context` by default; use `ph memory search <query> --include-sensitive` only when you need them. `ph close` remains a reviewed path for local project knowledge. The shared-memory MCP tools are available for agent-initiated search and save, but they are not required for automatic capture. Email, calendar, browser, and personal-assistant connectors are not included yet. See [the memory hub guide](memory-hub.md) for deployment, API, privacy boundaries, and current limitations.

---

## 10. Database

**Location:** `~/.prompt_history.db` (configurable via `ph config set db-path`)

**Tables:**

| Table | Purpose |
|-------|---------|
| `prompts` | Main prompt+response storage with FTS5 index |
| `prompts_archive` | Archived (retention-aged) prompts |
| `memories` | Append-only per-project analysis timeline |
| `project_summaries` | Single curated row per project with merged knowledge |
| `personal_memories` | Source-attributed work, personal, or project memory records |
| `personal_memory_versions` | Prior state captured when a personal memory is forgotten or restored |
| `vec_embeddings` | Vector embeddings (768-dim float, sqlite-vec) |
| `embeddings` | Legacy BLOB embeddings (migrated on connect) |

**Maintenance:**

```bash
ph vacuum              # compact DB
ph cleanup             # remove short/trivial/duplicate prompts
ph cleanup --retention # archive per retention policy
ph embed-all           # generate vectors for prompts without embeddings
```

---

## 11. Filter Pipeline

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

## 12. Configuration (`~/.ph_config.json`)

| Key | Default | Description |
|-----|---------|-------------|
| `dbPath` | `~/.prompt_history.db` | SQLite database path |
| `analyzeProvider` | `ollama` | LLM provider: `ollama`, `gemini`, `openrouter`, or `mlx-serve` |
| `ollamaUrl` | `http://localhost:11434` | Ollama server URL |
| `ollamaModel` | `llama3.1:latest` | Analysis model |
| `ollamaEmbedModel` | `nomic-embed-text-v2-moe` | Embedding model |
| `geminiApiKey` | — | Gemini API key |
| `openrouterModel` | — | Exact OpenRouter model ID |
| `openrouterUrl` | `https://openrouter.ai/api/v1` | OpenRouter-compatible API root |
| `mlxServeModel` | — | Exact MLX-Serve model ID |
| `mlxServeUrl` | `http://127.0.0.1:11234/v1` | MLX-Serve inference-service API root (optionally reached through an SSH tunnel) |
| `backgroundAnalysis` | `false` | Auto-analyze after each capture |
| `filterMinLength` | `15` | Min prompt length to keep |
| `filterMinRelevance` | `3` | Min relevance to keep (0=disable) |
| `retentionDays` | `90` | Auto-archive after N days |
| `retentionMinStarred` | `true` | Keep starred prompts |
| `retentionMinAnalyzed` | `true` | Keep analyzed prompts |
| `retentionMinRelevance` | `3` | Archive prompts below this relevance |
| `remoteUrl` | — | Remote ph server URL (or `PH_REMOTE_URL` env) |
| `remoteApiKey` | — | Remote server API key |
| `memoryHubUrl` | — | Governed memory API URL (or `PH_MEMORY_HUB_URL` env); separate from transcript sync |
| `memoryHubApiKey` | — | Memory hub key (or `PH_MEMORY_HUB_API_KEY` env); redacted by config commands |
| `memoryAutoCapture` | Enabled when hub URL and key are configured | Automatically extract evidence-backed work/project memories after supported coding-agent captures |
| `remoteLastPush` | — | Global timestamp of last successful push |
| `remoteLastPull` | — | Global timestamp of last successful pull |

Provider API credentials are environment-only: `OPENROUTER_API_KEY` and
`MLX_SERVE_API_KEY` (`GLB_OMLX_API_KEY` is a fallback). They are not written to
`~/.ph_config.json`.

---

## 13. Architecture

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
  importer/           # Gemini/Claude/OpenCode/Codex history importers
hooks/                # Shell scripts and plugins for AI tools
```

---

## 14. Importing Existing History

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

## 15. Versioning and Releases

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
