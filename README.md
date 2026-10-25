# ph — Prompt History and Project Memory

`ph` captures prompt and response history from AI command-line tools and makes it searchable from the terminal or available to agents through MCP. It stores data in a local SQLite database and can optionally analyze, archive, or synchronize that data.

## What it does

- Captures conversations through a transparent command wrapper, native hooks, direct logging, or history import.
- Searches prompts and responses, then retrieves task-relevant project context through one command.
- Reviews recent work and saves durable project decisions only after explicit approval.
- Keeps data local by default; hooks and MCP are available for automatic capture and agent access.

## Install

Install from npm:

```bash
npm install -g @gi4nks/ph
```

Or build from source:

```bash
git clone https://github.com/gi4nks/ph.git
cd ph
npm ci
npm run build
npm link
```

Requires Node.js 22 or later (the Wise/AI SDK provider stack requires Node 22). Ollama is optional; it is used for local analysis and semantic embeddings. Gemini can be used for analysis when configured.

## Quick start

```bash
# Connect PH once to the AI CLIs you use
ph setup

# Then use Claude Code, Codex, or Gemini CLI normally. Completed exchanges
# are captured in the background by each tool's native hook.
claude
codex

# Search prompt history
ph search "goroutines"
ph show 42                       # Full prompt, response, and available analysis
# Search all projects when needed
ph search --all "goroutines"

# Add a record directly
ph log --tool claude --prompt "Explain this function" --response "It parses..."
```

`ph setup` detects installed Claude Code, Codex CLI, Gemini CLI, and OpenCode integrations, then installs capture hooks while preserving existing settings. Pass tool names to select explicitly (`ph setup codex claude`). It is safe to run again. Use `ph <tool>` as a wrapper if you prefer not to install hooks.

`ph search "query"` searches the current project and shows five matches, ranked by text relevance. Use `--limit <n>` for more results or `--all` to search across projects. Codex hook captures use the active CLI working directory so new conversations get associated with the project where Codex was launched.

## Capture history

### Wrapper

Run an installed tool through `ph` to record its prompt and response:

```bash
ph claude "explain goroutines"
ph --ph-role debug --ph-tag auth claude "fix JWT expiration"
```

Interactive wrapper mode is available when the wrapped tool is run without command-line prompt arguments.

### Native hooks

Hooks capture completed exchanges without changing the tool invocation:

- Claude Code: [hooks/claude/ph-hook.sh](hooks/claude/ph-hook.sh)
- Codex CLI: [hooks/codex/ph-hook.sh](hooks/codex/ph-hook.sh)
- Gemini CLI: [hooks/gemini/ph-hook.sh](hooks/gemini/ph-hook.sh)
- OpenCode: [hooks/opencode/ph-plugin.ts](hooks/opencode/ph-plugin.ts)

See [docs/hooks.md](docs/hooks.md) for the integration overview and [docs/ph-manual.md](docs/ph-manual.md) for setup details.

### Direct logging and history import

```bash
ph log --tool claude --prompt "Explain this function" --response "It parses..."
echo '{"tool":"claude","prompt":"Explain this function","response":"It parses..."}' | ph log --stdin

ph import claude --dry-run
ph import gemini --filter
ph import opencode
ph import codex --dry-run
```

Codex is also available through wrapper mode: `ph codex exec "prompt"`. See [Codex hook setup](hooks/codex/README.md).

## Search and project context

```bash
ph search --tool claude --role debug --since 2026-01-01
ph search --semantic "How did I configure SQLite migrations?"
ph search --archive "database migration"
ph show 42 --json                # Machine-readable interaction detail
ph show 42                       # full prompt, response, and available analysis
ph show 42 --json                # machine-readable detail

# Retrieve project knowledge and related prompts for the current directory
ph context "How are database migrations handled?"

# Limit the output to project summaries and memories
ph context --memories-only --project ph

# Retrieve a task brief with relevant history (read-only)
ph context "add Wise provider" --limit 5 --budget 3500

# Review recent work and explicitly promote useful knowledge (defaults to 3h)
ph close
ph close --from 1670 --to 1682 --dry-run
```

`ph context "task"` retrieves task-specific history when you want to supply it explicitly. `ph close` is an optional review workflow for promoting durable knowledge; it is not required for capture or search. `ph prepare` remains a compatibility alias for `ph context`.

Running `ph` prints the short setup-first workflow; it does not open a TUI. `ph browse` remains as a compatibility alias for listing recent interactions. `ph help --all` lists maintenance and integration commands.

## Project memory and analysis

Enable background analysis after each capture:

```bash
ph config set background-analysis true
ph config set analyze-provider ollama
ph config set ollama-model llama3.1:latest
ph config set ollama-embed-model nomic-embed-text-v2-moe
```

For Gemini analysis:

```bash
ph config set analyze-provider gemini
ph config set gemini-api-key "$GEMINI_API_KEY"
```

For OpenRouter, use the environment or enter the key through ph's hidden prompt, then select an exact model ID:

```bash
export OPENROUTER_API_KEY="your_openrouter_api_key"
ph models openrouter
ph config set openrouter-api-key        # prompts securely; stored in ~/.ph_config.json
ph config set analyze-provider openrouter
ph config set openrouter-model "provider/model-id"
ph config show                         # shows active settings, redacts keys
ph analyze
```

For a remote MLX-Serve inference service, open an SSH tunnel to its API port
(11234 by default), then select an ID returned by the service. Keep the tunnel
running in a separate terminal:

```bash
# Terminal 1
ssh -N -L 11234:127.0.0.1:11234 user@inference-host
```

```bash
# Terminal 2
ph models mlx-serve
ph config set analyze-provider mlx-serve
ph config set mlx-serve-model "exact-model-id-from-server"
ph analyze
```

The MLX-Serve URL defaults to `http://127.0.0.1:11234/v1`; override it with
`MLX_SERVE_BASE_URL` or `ph config set mlx-serve-url <url>`. If the server requires
authentication, set `MLX_SERVE_API_KEY` or run `ph config set mlx-serve-api-key`
for a hidden prompt. `ph config show` redacts credentials. The model catalog
marks installed models as `[loaded]` or `[unloaded]`.

Automatic analysis enriches each interaction with classification, summary, insights, and decisions; these derived fields are searchable and visible with `ph show`. Analysis does not modify active project memories or summaries. Only approved `ph close` proposals and MCP `save_decision` promote knowledge. Existing memories remain available. Task context retrieval is shared by `ph context`, `ph chat`, and MCP knowledge checks, with a labeled recent-history fallback.

## MCP integration

Start the stdio server with:

```bash
ph mcp
```

The server exposes tools for prompt search and lookup, project context and summaries, project timelines, knowledge checks, and saving decisions. When the memory hub is configured, it also exposes `search_shared_memory` and `save_shared_memory` for non-sensitive work/project memories. Configure `ph mcp` as a stdio server in the MCP client you use.

## Remote sync

Run an HTTP server on the machine that will store the shared database:

```bash
ph config set remote-api-key "$PH_REMOTE_API_KEY"
ph server --host 127.0.0.1 --port 3001
```

Set a client remote URL and synchronize:

```bash
ph config set remote-url http://127.0.0.1:3001
ph remote push
ph remote pull
ph remote status
```

`PH_REMOTE_URL` overrides the configured remote URL. The server refuses to start until `remote-api-key` is configured, and every client must provide the same key. It listens on loopback by default; use an explicit `--host` only for a protected network interface and use TLS when traffic crosses an untrusted network. `/health` is public and returns status only. Resumable ID cursors are scoped to both the remote target and local database, and byte-bounded subpages stay below the server's 32 MiB request cap. A bulk push pauses before a live wrapper interaction until its response is saved. `ph log` and both wrapper modes push after capture when a remote is configured; the request is bounded to five seconds so an unavailable server cannot hang the command indefinitely. An invalid remote URL does not prevent local capture or launching the wrapped tool. Current limitation: a remote database replacement behind the same URL is not detected, and last-push/pull status timestamps are shared across targets.

## Shared memory hub

The optional memory hub stores source-attributed work and personal memories centrally. Configure it separately from prompt-history sync:

```bash
ph config set memory-hub-url https://memory.example
ph config set memory-hub-api-key
ph memory save "Prefers short technical explanations" --scope work --kind preference
ph memory search "technical explanations"
ph context "implement the cache"
```

`ph close` can share only the project-knowledge proposals you approve, with prompt IDs as provenance. `ph context` retrieves non-sensitive work and project memories from the hub. Sensitive memories require `ph memory save ... --sensitive` and are excluded from context unless explicitly requested with `ph memory search --include-sensitive`. The memory hub does not upload raw prompt history; `ph remote push` remains a separate operation. See [docs/memory-hub.md](docs/memory-hub.md) for deployment, API, privacy boundaries, and current limits.

When the memory hub is configured, supported coding CLI captures also trigger a background memory pass by default. PH sends the interaction to the configured analysis provider, saves only directly evidenced durable work preferences or accepted project decisions to the hub, and records their prompt source IDs. It never writes personal-scope or model-flagged sensitive memories automatically. Use `ph status` to see extraction state, `ph memory undo <interaction-id>` to forget everything saved from an interaction, or `ph config set memory-auto-capture false` to disable this behavior. The MCP save tool remains available for agents and is not the trigger for automatic extraction.

## Configuration and storage

Configuration is stored in `~/.ph_config.json`; the database defaults to `~/.prompt_history.db`.

| Setting | Default | Purpose |
|---|---|---|
| `db-path` | `~/.prompt_history.db` | SQLite database location |
| `analyze-provider` | `ollama` | Analysis provider: `ollama`, `gemini`, `openrouter`, or `mlx-serve` |
| `ollama-url` | `http://localhost:11434` | Ollama endpoint |
| `ollama-model` | `llama3.1:latest` | Analysis model |
| `openrouter-model` | unset | Exact OpenRouter model ID, including its provider prefix |
| `openrouter-url` | `https://openrouter.ai/api/v1` | OpenRouter-compatible API root |
| `mlx-serve-model` | unset | Exact model ID returned by MLX-Serve |
| `mlx-serve-url` | `http://127.0.0.1:11234/v1` | MLX-Serve inference-service API root, optionally reached through an SSH tunnel |
| `ollama-embed-model` | `nomic-embed-text-v2-moe` | Embedding model; current schema expects 768 dimensions |
| `background-analysis` | `false` | Analyze newly captured prompts asynchronously |
| `filter-min-length` | `15` | Minimum prompt length accepted by filtering |
| `filter-min-relevance` | `3` | Relevance threshold for filtered imports/analysis workflows |
| `remote-url` | unset | Remote `ph` server; `PH_REMOTE_URL` takes precedence |
| `remote-api-key` | unset | Required to start the HTTP server; sent by remote clients |

Provider credentials can be stored in `~/.ph_config.json` through the hidden
`ph config set <provider>-api-key` prompts or supplied through environment
variables. Environment values take precedence; MLX-Serve also accepts the
existing `GLB_OMLX_API_KEY` variable.

## Development

```bash
npm ci
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Run the optional model-backed retrieval evaluation when an Ollama embedding endpoint is available:

```bash
npm run eval:retrieval
```

See [docs/ph-manual.md](docs/ph-manual.md), [docs/specs/SPEC-INDEX.md](docs/specs/SPEC-INDEX.md), and [docs/ph-analysis.html](docs/ph-analysis.html) for the user guide, behavior specifications, and architecture report.

## License

MIT
