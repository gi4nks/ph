# ph — Prompt History & Analysis Tool

`ph` is a transparent observability layer for AI CLI tools. It captures every prompt+response into a local SQLite database with full-text and semantic search, automatic LLM analysis, interactive TUI browser, MCP server, and optional remote sync for cross-laptop memory sharing.

## Key Features

- 📥 **Automatic Capture**: Wrapper mode (`ph claude "..."`), hook mode (Claude/Gemini/OpenCode), or direct (`ph log`).
- 🔍 **Advanced Search**: FTS5 full-text search and sqlite-vec semantic search with rich filters (tool, project, role, tag, date range).
- 🧠 **Background Analysis**: Automatic prompt classification (role, tags, relevance) via Ollama or Gemini — builds project-level memories.
- 🖥️ **Interactive TUI**: Full-screen browser with filter panel, preview pane, project memory viewer, and session grouping.
- 🔌 **MCP Server**: Exposes prompt history and project knowledge as MCP tools (`search_prompts`, `get_prompt`, `search_project_memory`, etc.) — usable by any MCP client including OpenCode.
- 🌐 **HTTP Server & Remote Sync**: `ph server` starts a REST API. `ph remote push|pull` syncs prompts across laptops. Background push after each `ph log`.
- 🔗 **OpenCode Plugin**: Native plugin for real-time capture via OpenCode hooks.

## Installation

```bash
# Clone and local build
git clone git@github.com:gi4nks/ph.git
cd ph
npm install
make build
make install
```

Or install from npm:
```bash
npm install -g @gi4nks/ph
```

## Quick Start

```bash
# Wrap an AI tool
ph claude "explain goroutines"

# Search history
ph search "goroutines"
ph search --semantic "concurrency patterns"
ph search --tool claude --role debug --since 2026-01-01

# Browse with TUI
ph browse

# Start HTTP server for remote sync
ph server --port 3001

# Sync with another machine
export PH_REMOTE_URL=http://my-server:3001
ph remote push   # push local prompts to server
ph remote pull   # pull remote prompts into local DB
```

## Configuration

Config file at `~/.ph_config.json`:

```bash
ph config set analyze-provider ollama    # or 'gemini' (default: ollama)
ph config set background-analysis true    # auto-analyze after each log
ph config set remote-url http://server:3001  # remote sync target
```

Environment variable `PH_REMOTE_URL` takes precedence over config.

## Storage

| Item | Default Path | Description |
|------|--------------|-------------|
| Database | `~/.prompt_history.db` | SQLite with FTS5 + sqlite-vec |
| Config | `~/.ph_config.json` | JSON with 0o600 permissions |

## Architecture

```
Capture modes: wrapper → hook → direct → OpenCode plugin
     |
     v
Local SQLite (FTS5 + vec0 + memories)
     |
     ├── MCP server (stdio)  →  OpenCode / any MCP client
     ├── HTTP server (REST)  →  remote ph instances
     └── Background analysis →  memories table (append-only per project)
```

## Hooks

Hooks in `hooks/` integrate with AI CLI tools natively:

- **Claude Code**: `hooks/claude/ph-hook.sh` — Stop hook
- **Gemini CLI**: `hooks/gemini/ph-hook.sh` — AfterAgent hook
- **OpenCode**: `hooks/opencode/ph-plugin.ts` — native plugin (captures streaming responses)

## Development

```bash
make build    # tsup build
make test     # vitest
make lint     # eslint
```

## License

MIT
