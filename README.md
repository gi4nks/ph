# ph — Prompt History and Project Memory

`ph` captures prompt and response history from AI command-line tools and makes it searchable from the terminal or available to agents through MCP. It stores data in a local SQLite database and can optionally analyze, archive, or synchronize that data.

## What it does

- Captures conversations through a transparent command wrapper, native hooks, direct logging, or history import.
- Searches prompts and responses with SQLite FTS5, or searches by semantic similarity with Ollama embeddings and sqlite-vec.
- Groups records by project, tool, language, role, tags, time, and quality metadata.
- Builds project summaries and an append-only analysis history with Ollama, Gemini, OpenRouter, or MLX-Serve through `@gi4nks/wise`.
- Exposes prompt history and project knowledge through an MCP server over stdio.
- Provides an interactive terminal browser for filtering, reviewing, editing metadata, starring, exporting, and rerunning prompts.
- The TUI `p` action sends the selected prompt to a configured Wise analysis provider; `r` reruns it with its original CLI tool.
- Supports optional HTTP sync between a local database and a remote `ph` server.

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
# Capture a prompt by wrapping an installed AI CLI tool
ph claude "explain goroutines"

# Search prompt history
ph search "goroutines"
ph search --semantic "concurrency patterns"

# Open the interactive browser
ph browse

# Add a record directly
ph log --tool claude --prompt "Explain this function" --response "It parses..."
```

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

Codex is also available through wrapper and context-injected modes: `ph codex exec "prompt"` and `ph chat codex exec "prompt"`. See [Codex hook setup](hooks/codex/README.md).

## Search and project context

```bash
ph search --tool claude --role debug --since 2026-01-01
ph search --semantic "How did I configure SQLite migrations?"
ph search --archive "database migration"

# Retrieve project knowledge and related prompts for the current directory
ph context "How are database migrations handled?"

# Limit the output to project summaries and memories
ph context --memories-only --project ph
```

`ph context`, `ph chat`, and MCP project-context tools use shared retrieval and formatting. Semantic results are scoped to the requested project before the result limit is applied.

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

For MLX-Serve on Parmenide, open an SSH tunnel to its API port (11234 by default),
then select an ID returned by the server. Keep the tunnel running in a separate terminal:

```bash
# Terminal 1
ssh -N -L 11234:127.0.0.1:11234 parmenide
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

Project summaries merge deduplicated insights and technical decisions. Individual analysis results remain in an append-only memory timeline. Analysis and embeddings require the corresponding provider to be available; basic capture and full-text search do not.

## MCP integration

Start the stdio server with:

```bash
ph mcp
```

The server exposes tools for prompt search and lookup, project context and summaries, project timelines, knowledge checks, and saving decisions. Configure `ph mcp` as a stdio server in the MCP client you use.

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

`PH_REMOTE_URL` overrides the configured remote URL. If `remote-api-key` is set on the server, clients must also provide that key. Use a private network or a TLS-terminating proxy when connecting across machines. Each `ph log` performs a non-blocking push when a remote is configured.

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
| `mlx-serve-url` | `http://127.0.0.1:11234/v1` | MLX-Serve API root, normally the Parmenide SSH tunnel |
| `ollama-embed-model` | `nomic-embed-text-v2-moe` | Embedding model; current schema expects 768 dimensions |
| `background-analysis` | `false` | Analyze newly captured prompts asynchronously |
| `filter-min-length` | `15` | Minimum prompt length accepted by filtering |
| `filter-min-relevance` | `3` | Relevance threshold for filtered imports/analysis workflows |
| `remote-url` | unset | Remote `ph` server; `PH_REMOTE_URL` takes precedence |
| `remote-api-key` | unset | Optional server authentication key |

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
