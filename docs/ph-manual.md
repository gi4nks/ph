# PH User Manual

PH is a local-first history and retrieval tool for AI coding work. It captures completed coding-agent exchanges, lets you search and inspect them later, and can supply relevant project context to a coding agent. Durable memories and raw prompt history are separate data flows.

For a visual inventory of current features, data flows, command families, and product limits, see the [Feature and Operations Catalog](ph-feature-catalog.html).

## 1. Install and connect your tools

PH requires Node.js 22 or newer. Install the published CLI:

```sh
npm install -g @gi4nks/ph
ph setup
```

`ph setup` detects supported tools on `PATH` and adds PH's native capture hook or plugin to their existing user configuration. Supported integrations are Claude Code, Codex CLI, Gemini CLI, OpenCode, and Google Antigravity (AGY). Use `agy` or `antigravity` for the latter. PH preserves unrelated configuration entries and refuses to overwrite an existing OpenCode plugin with different contents. You can select integrations explicitly:

```sh
ph setup claude codex
ph setup agy
ph setup antigravity
```

Restart the affected coding tools after PH installs or updates an integration. For detailed integration behavior and manual configuration, see [Capture Hooks](hooks.md).

OpenCode's plugin writes a prompt/response pair when the next user message arrives. If you close the session right after an answer, the last exchange may not yet be stored; backfill it from OpenCode's local history with ph import opencode --dry-run.

Confirm setup and recent capture state with:

```sh
ph status
```

If a tool cannot use the native integration, run it through PH. PH passes the tool's arguments through and captures the exchange:

```sh
ph claude
ph codex --help
ph --ph-role debug --ph-tag auth claude "Fix the token refresh bug"
```

The normal `ph` invocation prints a short command guide. PH does not open an interactive browser or TUI, and it does not inject retrieved context into an agent automatically. Run `ph context` when you want to inspect and pass prior project knowledge yourself, or connect `ph mcp` and let an agent call its context tools.

For scripts or a one-off manual record, `ph log` accepts flags or JSON from stdin:

```sh
ph log --tool codex --prompt "Question text" --response "Answer text"
printf '%s' '{"tool":"codex","prompt":"Question text","response":"Answer text"}' | ph log
```

Avoid putting sensitive prompt text in shell history. Use a native hook, wrapper, or stdin for normal/private workflows.

## 2. Understand PH's three kinds of data

| Data | What it contains | Default location / transfer |
|---|---|---|
| Interaction history | User prompt, captured response, tool, time, working directory, exit status, and available metadata | Local SQLite database. It is not uploaded unless raw-history sync is configured. |
| Durable memories | Decisions, insights, facts, and preferences scoped to a project, work, or personal life | Local SQLite unless both shared-hub URL and key are configured, in which case memory commands use the shared hub. |
| Inference input | Bounded prompt/response text sent for analysis, embeddings, or automatic memory extraction | Sent to the selected inference provider only when that feature is used or enabled. |

By default the database is `~/.prompt_history.db`. `PH_DB` or `db-path` selects another location. PH stores configuration in `~/.ph_config.json` and writes it with mode `0600`.

## 3. Search and inspect earlier interactions

Search defaults to the project detected from the current directory and returns up to five matches. If PH cannot identify a project, it searches all saved work. `--all` explicitly searches across projects:

```sh
ph search "sqlite migration"
ph search --all "provider setup"
ph search --project ph --tool codex "memory schema"
ph search --since 2026-10-01 --until 2026-10-31 "migration"
ph search --tag auth --role debug "token refresh"
```

Filters include `--tool`, `--project`, `--language`, `--role`, `--tag`, `--starred`, `--min-quality`, `--min-relevance`, `--top` (quality 8 or higher), `--since`, `--until`, and `--limit`. `--full` removes the usual prompt/response truncation. The compatibility flag `-i` / `--interactive` only prints a notice and plain-text results; the history browser was removed.

Use semantic retrieval when embeddings exist:

```sh
ph search --semantic "How did we solve database locking?"
ph show 42
ph show 42 --prompt
ph show 42 --full
ph show 42 --json
ph export 42 --format md
```

Semantic search uses the configured Ollama embedding service. If vectors are missing, the provider is unavailable, or the stored vector model differs, PH reports the reason and falls back to text search. `ph show` displays capture details and analysis by default, with prompt and response bodies hidden behind their character counts. Use `--prompt` to reveal only the prompt, or `--full` to reveal both bodies. `--json` always returns the complete record. Add `--archive` to `show` or `export` to inspect an archived record. `ph search --archive` lists archived records by date and limit; it does not apply the query text or the normal search filters. Export formats are `txt`, `json`, and `md` and remain complete.

In a terminal, `ph show` puts the short analysis before the body sections so the useful summary is visible first. Section headings and analysis status use restrained colors; `NO_COLOR=1` disables color, and output redirected to a file or pipe stays plain text.

```text
Interaction #42
────────────────────────────────────────────────────
CAPTURE DETAILS
────────────────────────────────────────────────────
  Tool                codex
  Date                2026-11-06T10:30:00.000Z
  Project             ph
  Analysis status     complete

ANALYSIS
────────────────────────────────────────────────────
  Fixed a persistence boundary in the interaction repository.
  Relevance           8/10
  Quality             7/10

PROMPT
────────────────────────────────────────────────────
  Hidden (54 characters). Use ph show 42 --prompt or --full to display.

RESPONSE
────────────────────────────────────────────────────
  Hidden (60 characters). Use ph show 42 --full to display.

`--prompt` reveals the complete prompt while keeping the response hidden; `--full` reveals both. Use `--json` when another program needs the complete interaction as machine-readable data.
```

Other history views:

```sh
ph last 20
ph sessions --gap-hours 4 --min-size 3
ph sessions --export 2
ph timeline ph
ph stats
ph star 42
```

## 4. Retrieve project context

`ph context` is the main way to bring earlier work into a new coding task. Run it from a project directory or provide a project name:

```sh
ph context "add a memory search command"
ph context --project ph "how do migrations work?"
ph context --memories-only --project ph
ph context --prompts-only --project ph
ph context --verbose --limit 8 "search index"
```

PH combines local project/work memories with relevant project interactions. When a shared hub is configured, it also retrieves non-sensitive project/work memories from the hub. Personal and sensitive records are excluded. Without a query, PH returns recent project work. With a query, it uses full-text retrieval and, when available, fuses in semantic matches; if no interaction matches, it falls back to recent project interactions and notes that in the output. `--budget` controls the formatted local context section from 500 to 12,000 characters (default 3,500). Shared hub memories are appended separately and are outside that character cap, so total output can be larger.

Context retrieval works without an inference service. Semantic prompt retrieval needs indexed embeddings and the configured Ollama embedding model. If semantic retrieval is unavailable, PH uses full-text retrieval and explains the fallback in the output. `--verbose` includes up to 1,000 characters of each selected prompt, not the entire prompt; normal output includes a shorter prompt excerpt and a response excerpt.

## 5. Save and manage durable memories

Use memories for durable knowledge you expect to need again, not as a replacement for the full interaction archive. Memory kinds are `decision`, `insight`, `preference`, and `fact`; scopes are `project`, `work`, and `personal`.

```sh
ph memory add --project ph --kind decision "Keep the prompt archive on this computer by default"
ph memory add --scope work --kind preference "Write PH user documentation in English"
ph memory add --scope personal --sensitive "A sensitive fact saved only on explicit request"
ph memory add --project ph --prompts 42,45 "Validate project sources before saving a decision"
ph memory list --project ph
ph memory search "project sources"
ph memory search --scope personal --include-personal --include-sensitive "sensitive fact"
```

Inside a detected project, a new memory defaults to project scope. Outside a project it defaults to work scope. A project memory requires a project name; use `--project` or `--scope work` if no project is detected. Local memory writes validate cited interaction IDs, and project-scoped citations must belong to the same project. Sensitive writes require the explicit `--sensitive` flag.

When `--prompts` is supplied, PH verifies each prompt ID against the local history before saving, whether the memory will be local or shared. Shared records identify a prompt source with both the local database identity and prompt ID, so equal numeric IDs from different clients are not confused.

Without a configured hub, `ph memory add`, `list`, and `search` use local SQLite. With both `memory-hub-url` and `memory-hub-api-key` configured, new saves and list/search use the shared hub. `ph context` and MCP context/search combine local records with eligible shared work/project memories. For `show`, `forget`, and `restore`, a UUID addresses the hub and a numeric ID addresses a local record; local history remains on the client. Local IDs are numeric and shared IDs are UUIDs. `ph memory forget <id>` hides a record and keeps a reversible version; `ph memory restore <id>` restores it. Search excludes personal and sensitive memories by default. Use the corresponding explicit flags to include them.

To inspect extraction for a captured interaction:

```sh
ph status
ph memory retry 42
ph memory undo 42
```

`retry` re-runs background extraction for that interaction. `undo` reversibly forgets memories PH saved from it.

## 6. Shared memory and automatic extraction

The shared memory hub is optional. It is a canonical store for source-attributed memories shared by configured PH clients. It is distinct from prompt-history sync. See [Memory Hub](memory-hub.md) for deployment and API details.

Configure the URL and key on a client:

```sh
ph config set memory-hub-url https://<private-host>
ph config set memory-hub-api-key
```

When invoked without a value in an interactive terminal, PH prompts for secret config values without echoing them. In managed environments, use `PH_MEMORY_HUB_URL` and `PH_MEMORY_HUB_API_KEY` instead.

When both hub credentials exist and `memory-auto-capture` is not `false`, PH schedules extraction after completed captures from supported coding tools. Successful extraction also requires a usable inference provider; missing or unavailable providers cause the background attempt to fail, which is visible in `ph status`. The provider receives bounded copies of the user prompt and assistant response. PH accepts at most two durable work/project candidates and requires an exact supporting quote from the user prompt. Personal-scope candidates are not accepted; deterministic checks reject common sensitive and credential patterns, but model-based classification is not a guarantee. The hub receives derived memories and source references, not the raw interaction through this extraction flow. Manual memory source selection and context assembly are handled by the same `MemoryService` used by CLI and MCP; the automatic extraction worker remains a separate hub-only workflow.

Disable extraction explicitly when needed:

```sh
ph config set memory-auto-capture false
```

The capture hook itself can still store local prompt/response history. `ph status` shows whether extraction is disabled, configured, or has been scheduled for an interaction.

## 7. Optional LLM analysis and embeddings

Capture, text search, and basic project context do not require an LLM. Analysis providers are Ollama (default), Gemini, OpenRouter, and oMLX. Provider credentials and model identifiers can be set in PH config or their supported environment variables. Check `ph config set` help and `ph models <provider>` for the current options.

Example Ollama setup and analysis:

```sh
ph config set analyze-provider ollama
ph config set ollama-url http://127.0.0.1:8000
ph config set ollama-model qwen3.5:9b-mlx
ph config set background-analysis true
ph analyze --limit 100
```

For OpenRouter, configure `openrouter-api-key` and `openrouter-model`. For Gemini, configure `gemini-api-key`. For oMLX on Parmenide, select `omlx` and set `omlx-model`; the default endpoint is `http://parmenide:8000/v1`. Set the key with `ph config set omlx-api-key` (hidden interactive input) or `OMLX_API_KEY` in PH's process environment; optionally set `omlx-url` or `OMLX_BASE_URL`. If editing `~/.ph_config.json` directly, the property is `omlxApiKey`. `ph models ollama`, `ph models openrouter`, or `ph models omlx` lists models visible to the configured provider. Existing `mlx-serve` provider values, `mlx-serve-*` config keys, and `MLX_SERVE_*` environment variables remain accepted aliases; new saves write canonical `omlx-*` fields.

oMLX can load an installed model on the first inference request; `[unloaded]` does not mean the model cannot be used. Cold loading needs enough free memory on the inference host and must fit under oMLX's dynamic memory ceiling. If `ph analyze` reports `provider_out_of_memory`, free memory on that host, choose a smaller installed model, or raise the dynamic ceiling only when physical RAM headroom allows it. PH reports bounded provider failure categories without storing raw provider error bodies. Structured analysis uses oMLX's JSON response mode, a maximum of 800 output tokens, and a zero reasoning budget to avoid wasting tokens on hidden reasoning.

Ollama analysis uses the native `/api/generate` endpoint with `think: false`, JSON output mode, and a maximum of 800 output tokens for this short classification task. Background analysis is off by default. It can send captured prompt/response text to the selected provider after capture. `ph analyze --dry-run` still calls the provider, but does not write analysis metadata or delete records. `--force` reanalyzes existing records; `--prune` removes entries below the configured relevance threshold when dry-run is not enabled.

Semantic embeddings are generated through Ollama and use `ollama-embed-model` (default `nomic-embed-text-v2-moe`):

```sh
ph embed-all
ph search --semantic "database migration strategy"
```

## 8. MCP integration

`ph mcp` starts a local stdio MCP server. Add it to the MCP clients you want PH to serve. These commands use each CLI's current stdio registration syntax:

```sh
# Claude Code
claude mcp add --transport stdio ph -- ph mcp

# Codex CLI
codex mcp add ph -- ph mcp

# Gemini CLI (user-wide configuration)
gemini mcp add --scope user ph ph mcp

# OpenCode (global configuration)
opencode mcp add ph --global -- ph mcp
```

Restart or reload the agent and check its MCP status/list command. If it cannot locate the `ph` executable, use the absolute path to the installed PH binary. See the official setup references for [Claude Code](https://code.claude.com/docs/en/mcp), [Codex CLI](https://developers.openai.com/codex/mcp), [Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md), and [OpenCode](https://opencode.ai/docs/mcp-servers).

The five tools are:

- `search_history`: search captured interactions.
- `get_interaction`: inspect one interaction, including its full prompt and response.
- `get_project_context`: retrieve local context and configured shared non-sensitive memories.
- `search_memories`: search project/work memories locally and at a configured hub.
- `save_memory`: save a project/work memory; PH validates prompt sources before writing.

MCP does not decide whether to automatically extract memories from a conversation. Capture-triggered background extraction is a separate PH workflow. MCP does not expose personal or sensitive memory operations.

## 9. Raw prompt-history sync and HTTP service

Raw prompt/response sync is a separate, opt-in transfer from shared memories. To configure it, set `remote-url` and, if required by the server, `remote-api-key`:

```sh
ph config set remote-url https://<private-sync-host>
ph config set remote-api-key
ph remote push
ph remote pull
ph remote status
```

When `PH_REMOTE_URL` or `remote-url` is configured, completed new captures are pushed automatically. Explicit `ph remote push` and `ph remote pull` perform resumable bulk synchronization. Review the endpoint and authorization before configuring this: raw prompt and response text is transferred. This is independent of memory-hub credentials.

`ph server --port 3001` starts the HTTP service, bound to loopback by default; `--host` can override the bind address. Startup requires at least one credential: the history-service key (`PH_SERVER_API_KEY` or `remote-api-key`) or the memory-hub key (`PH_MEMORY_HUB_API_KEY` or `memory-hub-api-key`). A memory-only server can start with just the memory key; prompt-history routes remain unavailable without the history-service key. When both keys are configured, they must differ. `/health` is public and returns status only. Do not expose the listener directly to the public internet; use private networking or a properly secured TLS proxy and firewall.

For a generic Docker Compose deployment and API routes, see [Memory Hub](memory-hub.md).

## 10. Import existing history

The importers read local histories from Claude Code, Codex, Gemini CLI, OpenCode, and Antigravity. Preview an import first:

```sh
ph import codex --dry-run
ph import claude --dry-run
ph import opencode --dry-run
ph import gemini --dry-run
ph import agy --dry-run
```

Then omit `--dry-run` to write imported interactions. `--file <path>` selects one transcript where supported; `--workdir <path>` overrides project association. `--filter` applies configured noise filters. `--analyze` runs the configured analysis provider during import, including during a dry-run; dry-run prevents imported rows from being written. `--live` also starts configured follow-up processing—analysis, memory extraction, and remote sync—for imported records. Imports deduplicate repeated interactions.

## 11. Configuration reference

```sh
ph config show
ph config get analyze-provider
ph config set db-path /path/to/history.db
ph config set memory-auto-capture false
ph config set retention-days 120
```

`ph config show` reports providers and whether credentials are configured; secret values are redacted. Secret keys supplied without an inline value prompt in a terminal. Prefer this prompt or environment variables over placing secrets in shell history.

Important environment overrides include:

| Variable | Purpose |
|---|---|
| `PH_DB` | SQLite database path |
| `PH_REMOTE_URL` | Raw prompt-history sync server; enables push after completed captures |
| `PH_MEMORY_HUB_URL`, `PH_MEMORY_HUB_API_KEY` | Shared-memory hub client |
| `PH_SERVER_API_KEY` | Server-side bearer key for raw-history routes; required for those routes, not for a memory-only server |
| `PH_SERVER_HOST`, `PH_SERVER_PORT` | HTTP server bind address and port |
| `GEMINI_API_KEY` | Gemini analysis provider |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL` | OpenRouter analysis provider |
| `OMLX_MODEL`, `OMLX_BASE_URL`, `OMLX_API_KEY` | Canonical oMLX model, endpoint, and credential |
| `MLX_SERVE_MODEL`, `MLX_SERVE_BASE_URL`, `MLX_SERVE_API_KEY`, `GLB_OMLX_API_KEY` | Legacy oMLX environment aliases (used when canonical variable is unset) |

Other configuration keys are listed by `ph config set` with no key argument. Provider-specific URL/model settings and retention/filter options are persisted in `~/.ph_config.json`.

### PH configuration keys

| Key | Default | Purpose |
|---|---|---|
| `db-path` | `~/.prompt_history.db` | Local SQLite history and memory database; `PH_DB` overrides it. |
| `analyze-provider` | `ollama` | Provider for manual/background analysis and automatic memory extraction: `ollama`, `gemini`, `openrouter`, or `omlx` (`mlx-serve` remains accepted as an alias). |
| `ollama-url` | `http://localhost:11434` | Ollama generation and embedding endpoint. |
| `ollama-model` | `llama3.1:latest` | Ollama analysis model. |
| `gemini-api-key` | unset | Gemini analysis credential; `GEMINI_API_KEY` overrides it. PH uses Gemini 2.5 Flash. |
| `openrouter-url` | `https://openrouter.ai/api/v1` | OpenRouter-compatible endpoint; `OPENROUTER_BASE_URL` overrides it. |
| `openrouter-model` | unset | Required OpenRouter model ID; `OPENROUTER_MODEL` overrides it. |
| `openrouter-api-key` | unset | OpenRouter credential; `OPENROUTER_API_KEY` overrides it. |
| `omlx-url` | `http://parmenide:8000/v1` | oMLX OpenAI-compatible endpoint; `OMLX_BASE_URL` overrides it. |
| `omlx-model` | unset | Required exact model ID; `OMLX_MODEL` overrides it. |
| `omlx-api-key` | unset | Credential; `OMLX_API_KEY` overrides it. Secret value is redacted by `ph config get`. |
| `ollama-embed-model` | `nomic-embed-text-v2-moe` | Model used to create query and prompt embeddings. |
| `background-analysis` | `false` | Whether completed captures schedule LLM analysis. |
| `filter-min-length` | `15` | Minimum prompt length used by optional filtering and cleanup rules. |
| `filter-min-relevance` | `3` | Analysis/cleanup relevance threshold; zero disables the threshold. |
| `retention-days` | `90` | Age threshold for retention archival. |
| `retention-min-starred` | `true` | Protect starred records from retention archival. |
| `retention-min-analyzed` | `true` | Protect analyzed records from retention archival. |
| `retention-min-relevance` | `3` | Archive priority threshold for old low-relevance records. |
| `remote-url` | unset | Raw interaction-history sync server; `PH_REMOTE_URL` overrides it and enables automatic push after completed captures. |
| `remote-api-key` | unset | Client bearer key for raw-history routes; the server accepts it as its `PH_SERVER_API_KEY` value. |
| `memory-hub-url` | unset | Shared memory API base URL; `PH_MEMORY_HUB_URL` overrides it. |
| `memory-hub-api-key` | unset | Shared memory bearer key; `PH_MEMORY_HUB_API_KEY` overrides it. |
| `memory-auto-capture` | enabled when a hub is configured | Set `false` to stop automatic extraction after captures. |

Provider model/URL/key settings can also be supplied through the environment variables listed above. `ph config show` redacts credentials; use `ph config get <key>` for one non-secret setting.

## 12. Complete command reference

The default guide is intentionally short. The commands below describe the complete public CLI surface; internal `_bg-*` worker commands are implementation details and are not user commands.

| Command | Purpose and notable options |
|---|---|
| `ph` / `ph help` | Print the everyday guide. `ph help --all` prints the built-in command and flag reference. |
| `ph setup [claude|codex|gemini|opencode|agy]` | Install or update native capture integrations. With no names, detects supported executables on `PATH`. `antigravity` is an alias for `agy`. |
| `ph <tool> [args...]` | Forward arguments to an executable on `PATH` and capture the interaction. Prefix with `--ph-tag <tag>`, `--ph-role <role>`, or `--ph-debug`. Interactive sessions use a PTY; non-interactive capture infers the prompt from command arguments and records stdout as the response. |
| `ph log --tool <name> --prompt <text> [--response <text>] [--workdir <path>]` | Insert one explicit interaction. Alternatively pipe JSON with `tool`, `prompt`, optional `response`, and optional `workdir` to `ph log`. |
| `ph search [filters] [query]` | Search current project; `--all` searches all projects. Filters: `--tool`, `--project`, `--language`, `--role`, `--tag`, `--starred`, `--min-quality`, `--min-relevance`, `--top`, `--since`, `--until`, `--limit`, `--semantic`, `--full`, `--archive`. `--archive` is a date/limit listing, not full-text archive search. |
| `ph show <id> [--prompt|--full] [--json] [--archive]` | Inspect capture details and analysis; reveal the prompt or both text bodies on request. JSON remains complete. |
| `ph context [options] [query]` | Retrieve local project/work memories and relevant project interactions, plus eligible shared memories when configured. Options: `--project`, `--limit` (1–20), `--prompts-only`, `--memories-only`, `--verbose`, and `--budget` (500–12,000 characters for local context). |
| `ph memory add <text> [options]` | Save a durable memory. Options include `--kind decision|insight|preference|fact`, `--scope project|work|personal`, `--project`, `--prompts`, and explicit `--sensitive`. |
| `ph memory list [options]` / `search <query> [options]` | List or FTS-search memories. Options include `--project`, `--scope`, `--all`, `--include-personal`, `--include-sensitive`, and `--limit`. `show`, `forget`, and `restore` inspect or reversibly change a memory; shared IDs are UUIDs and local IDs are numeric. `retry <interaction-id>` retries automatic extraction; `undo <interaction-id>` forgets its automatically saved records. |
| `ph status` | Show history totals, memory count, recent capture status, and analysis, automatic-memory, and remote-push states without printing prompt/response contents. |
| `ph last [n]` / `ph timeline [project]` | Show recent interactions or chronological project history. |
| `ph sessions [options]` | Group interactions using `--gap-hours` (default 2), `--limit` (default 20), and `--min-size`; `--no-cohesion` skips embedding-based cohesion; `--export <n>` writes one session as Markdown. |
| `ph stats` / `ph star <id>` | Show archive statistics or toggle an interaction's starred state. |
| `ph export <id> [--format txt|json|md] [--archive]` | Export a complete active or archived interaction. |
| `ph import <claude|codex|gemini|opencode|agy> [options]` | Backfill local tool histories. Options: `--dry-run`, `--analyze`, `--filter`, `--file`, `--workdir`, and `--live`. File selection is supported only by importers with transcript/database file input. `--live` runs configured post-capture processing on imported records. |
| `ph analyze [options]` | Run LLM analysis on untagged records (default maximum 50). Options: `--limit`, `--force`, `--prune`, `--min-score`, and `--dry-run`. The current dry-run still calls the provider and persists successful analysis metadata; it only prevents prune deletion and some status writes. |
| `ph models [ollama|openrouter|omlx]` | List models visible from Ollama, OpenRouter, or oMLX. Gemini model selection is not exposed by this command. `mlx-serve` remains accepted as an alias. |
| `ph embed-all` / `ph search --semantic` | Build and use the Ollama vector index. Model mismatch or unavailable embeddings falls back to text search. |
| `ph config show|get|set` | Inspect providers and settings, read a key, or change configuration. Secret keys are redacted; omit a secret value in an interactive terminal to enter it without echo. |
| `ph mcp` | Start PH's local stdio MCP server for the five tools listed above. Agents must call these tools; MCP does not itself trigger memory extraction. |
| `ph server [--host <address>] [--port <port>]` | Start the authenticated HTTP API. Loopback and port 3001 are defaults. Server credential requirements are described in section 9. |
| `ph remote push|pull|status` | Resumable raw interaction-history synchronization with the configured PH server. |
| `ph cleanup [--dry-run] [--min-length N] [--min-score N] [--days N]` | Rule-based cleanup. Without dry-run, matching records are deleted; `--days` deletes older interactions and rule cleanup also runs. |
| `ph cleanup --retention [--dry-run]` | Apply retention rules to archive old interactions; old archived rows may be purged after the retention window. |
| `ph vacuum` | Compact the SQLite database after deletions. |

For exact syntax and examples, use `ph help --all` and the command-specific usage printed when a command is run without required arguments.

## 13. Maintenance and troubleshooting

| Command | Use |
|---|---|
| `ph stats` | Inspect counts and history breakdowns. |
| `ph sessions` | Group interactions into work sessions; `--export <n>` exports one session as Markdown. |
| `ph timeline [project]` | Review chronological project interactions and memories. |
| `ph star <id>` | Mark or unmark a useful interaction. |
| `ph export <id> --format json` | Export an interaction for backup or inspection. |
| `ph cleanup --dry-run [--min-length N] [--min-score N]` | Preview noise, duplicates, and low-relevance deletion. Without `--dry-run`, matching active records are deleted. `--days N` also deletes records older than N days. |
| `ph cleanup --retention --dry-run` | Preview retention archiving. |
| `ph cleanup --retention` | Archive records matching retention rules; archived entries older than twice the configured retention age are purged during this run. |
| `ph vacuum` | Compact the SQLite database. |

- **No captures:** run `ph status`; run `ph setup` and restart the coding tool. If needed, try `ph <tool>` to capture through the wrapper.
- **A tool was not detected:** pass its supported name explicitly to `ph setup` or check that its executable is on `PATH`.
- **No project detected:** run from the repository directory or supply `--project <name>` to `ph context` and project-memory commands.
- **Semantic search falls back to text:** run `ph embed-all`, check the Ollama URL/model, then retry. Text search and basic context continue to work without embeddings.
- **Memory or remote requests fail:** check `ph config show`, the hub or remote URL, network access, and the separate API key for that service. `ph status` shows background-memory and automatic-push status.
- **Inspecting cleanup or data changes:** cleanup can permanently delete records or purge old archive entries. Use `--dry-run` first and back up the SQLite database before maintenance.

Run `ph help --all` for the complete built-in command and option list.
