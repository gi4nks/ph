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

### From npm

```bash
npm install -g @gi4nks/ph
```

### From source

```bash
git clone git@github.com:gi4nks/ph.git
cd ph
npm install
make build
make install
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

| Option | Default | Description |
|--------|---------|-------------|
| `analyze-provider` | `ollama` | LLM provider for analysis (`ollama` or `gemini`) |
| `gemini-api-key` | — | API key for Gemini provider |
| `ollama-url` | `http://localhost:11434` | Ollama server URL |
| `ollama-model` | `llama3.1:latest` | Ollama model for analysis |
| `ollama-embed-model` | `nomic-embed-text-v2-moe` | Ollama model for embeddings |
| `background-analysis` | `false` | Auto-analyze after each `ph log` |
| `remote-url` | — | HTTP URL of remote ph server |
| `remote-api-key` | — | Optional API key for remote server |
| `db-path` | `~/.prompt_history.db` | Custom database path |
| `filter-min-length` | `15` | Ignore prompts shorter than N chars |
| `filter-min-relevance` | `3` | Minimum relevance score (0–10) |

## Remote Server Setup

### Ubuntu (systemd)

Install ph on your remote server:

```bash
sudo npm install -g @gi4nks/ph
```

Create `/etc/systemd/system/ph.service`:

```ini
[Unit]
Description=ph remote sync server
After=network.target

[Service]
Type=simple
ExecStart=<path-to-ph> server --port 3001 --host 0.0.0.0
Restart=always
RestartSec=5
User=<your-user>
Environment=NODE_ENV=production
StandardOutput=append:/var/log/ph-server.log
StandardError=append:/var/log/ph-server.log

[Install]
WantedBy=multi-user.target
```

Find `<path-to-ph>` with `which ph` on the server. Start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ph.service
sudo ufw allow 3001/tcp   # if firewall is active
```

### macOS (launchd)

Create `~/Library/LaunchAgents/com.gi4nks.ph.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gi4nks.ph</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/ph</string>
        <string>server</string>
        <string>--port</string>
        <string>3001</string>
        <string>--host</string>
        <string>0.0.0.0</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/ph-server.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/ph-server.err</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.gi4nks.ph.plist
```

### Client configuration

```bash
# Set remote URL (config or env)
ph config set remote-url http://your-server:3001
# export PH_REMOTE_URL=http://your-server:3001

# Sync
ph remote push   # send local prompts to server
ph remote pull   # fetch server prompts locally
ph remote status # check sync state
```

## How Releases Work

Releases are automated via **semantic-release** on push to `main`:

1. Push conventional commits (`feat:`, `fix:`, `chore:`, etc.) to `main`
2. GitHub Actions runs `npx semantic-release`
3. Semantic-release analyzes commits since last release
4. Bumps version automatically (major/minor/patch)
5. Generates `CHANGELOG.md`
6. Creates a git tag
7. Publishes to npm with **OIDC trusted publishing** (provenance attestation)
8. Creates a GitHub Release

The published package is signed with provenance — you can verify it with:

```bash
npm audit signatures
```

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
