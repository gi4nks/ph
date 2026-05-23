# ph — Prompt History CLI

**Architecture, Hook System & Usage Guide**

---

## 1. Overview

ph is a transparent capture layer for AI CLI tools such as Claude Code and Gemini CLI. Every prompt you type — and the AI response that follows — is automatically saved to a local SQLite database with full-text and semantic search, Git context, and optional background analysis.

The core design principle is zero friction: ph never interrupts your workflow. Capture happens silently in the background. Your AI sessions remain unchanged.

### Key Features

- **Automatic Capture** — saves prompts, responses, and metadata without any manual action
- **Git Context** — records current branch, modified files, and diff at capture time
- **Full-text & Semantic Search** — FTS5 text search and vector-based semantic search (via Ollama embeddings)
- **Background Analysis** — automatic role/tag/relevance classification via Ollama or Gemini
- **Interactive TUI** — browse, filter, edit, re-run, and export your history with `ph browse`
- **Privacy First** — all data stays local; no data ever leaves your machine

---

## 2. Architecture

ph uses a two-tier storage model: a SQLite database with FTS5 full-text indexing for fast retrieval, and a JSON config file for runtime settings. Both live in your home directory by default.

### Storage Layout

| Item | Default Path | Description |
|------|-------------|-------------|
| Database | `~/.prompt_history.db` | SQLite with FTS5 + vector embeddings |
| Config | `~/.ph_config.json` | JSON config file (0o600 permissions) |

The database uses WAL (Write-Ahead Logging) mode, enabling concurrent reads and writes. This is essential for the background analysis system, which processes prompts asynchronously without blocking your terminal session.

---

## 3. The Hook System

The hook system is ph's most powerful integration mechanism. Rather than requiring you to manually invoke ph for each session, hooks let the AI CLI tools themselves notify ph after every interaction — automatically, silently, and without any impact on response latency.

> **Key insight:** Hooks are post-action handlers registered inside the AI tool's own config. ph never wraps or intercepts the AI process. The AI runs normally; the hook fires after the session ends.

### How Hooks Work

Each supported AI CLI tool exposes a native hook mechanism:

- **Claude Code** — provides a `Stop` hook, triggered after each agent session completes
- **Gemini CLI** — provides an `AfterAgent` hook, triggered after each agent turn

When the hook fires, the AI tool passes a JSON payload on stdin to your registered script. The script reads that payload, extracts the prompt and response, and pipes the data to `ph log` — which persists everything to the local SQLite database.

The entire operation runs in the background using shell job control (`& + disown`), so it never adds latency to your terminal session and never blocks the AI tool from exiting.

---

### Claude Code Hook

#### How Claude Code delivers data

When the `Stop` hook fires, Claude Code sends a JSON object on stdin:

```json
{
  "session_id": "abc123...",
  "transcript_path": "/path/to/session.jsonl"
}
```

The transcript is a JSONL file — one JSON object per line — containing the full session history. Each line is one of:

| Turn type | Identifier |
|-----------|-----------|
| Human turn | Has `promptId` key; `message.content` is a plain string |
| Tool result | Has `toolUseResult` key; `message.content` is an array |
| Assistant turn | `message.role == "assistant"`; content is an array of typed blocks |

#### What the hook script does

1. Reads the hook input from stdin to obtain the transcript path
2. Uses `jq` with slurp mode to parse the entire JSONL in one pass
3. Filters for genuine human turns: must have `promptId`, string content, and no `toolUseResult` key
4. Extracts the last human turn as the prompt
5. Scans assistant turns for the last `text`-type block as the response
6. Builds a JSON payload with `tool`, `prompt`, `response`, and `workdir` fields
7. Pipes the payload to `ph log` running in the background (`& + disown`)
8. Exits `0` unconditionally — Claude Code is never blocked

#### Hook installation — Claude Code

```bash
# Step 1: link the hook script
ln -sf /path/to/ph/hooks/claude/ph-hook.sh ~/.claude/ph-hook.sh

# Step 2: register in ~/.claude/settings.json
{
  "hooks": {
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/ph-hook.sh",
            "async": true
          }
        ]
      }
    ]
  }
}
```

---

### Gemini CLI Hook

#### How Gemini CLI delivers data

Gemini CLI's `AfterAgent` hook is simpler: it delivers the prompt and response directly in the stdin payload, with no transcript file to parse:

```json
{
  "session_id": "...",
  "transcript_path": "...",
  "cwd": "/path/to/workdir",
  "hook_event_name": "AfterAgent",
  "timestamp": "...",
  "prompt": "the user's prompt text",
  "prompt_response": "the assistant's full response text"
}
```

#### What the hook script does

1. Reads the JSON payload from stdin
2. Extracts `prompt`, `prompt_response`, and `cwd` directly via `jq`
3. Builds a JSON payload with `tool`, `prompt`, `response`, and `workdir` fields
4. Pipes to `ph log` in the background
5. Exits `0` unconditionally

#### Hook installation — Gemini CLI

```bash
# Step 1: link the hook script
ln -sf /path/to/ph/hooks/gemini/ph-hook.sh ~/.gemini/ph-hook.sh

# Step 2: register in ~/.gemini/settings.json
{
  "hooks": {
    "AfterAgent": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.gemini/ph-hook.sh"
          }
        ]
      }
    ]
  }
}
```

---

### OpenCode Hook

OpenCode uses a JavaScript/TypeScript **plugin** system (rather than shell scripts). The `ph` integration is a plugin that hooks into OpenCode's message lifecycle to capture prompts and responses.

#### How the plugin captures data

The plugin registers two hooks inside OpenCode's runtime:

| Hook | Purpose |
|------|---------|
| `chat.message` | Intercepts every message in the conversation. User messages become prompts; assistant messages become response snapshots. |
| `experimental.text.complete` | Fires after streaming completes. Replaces the snapshot with the full, final response text. |

**Data flow:**

```
User types prompt
  → chat.message fires (role: user)
  → plugin stores the prompt text + metadata (agent, model, workdir)

Assistant streams response
  → experimental.text.complete fires for each text part
  → plugin accumulates the complete response text

Next user message or session end
  → plugin pairs prompt + accumulated response
  → pipes {"tool":"opencode","prompt":"...","response":"..."} to ph log
  → runs in background — never blocks OpenCode
```

#### Hook installation — OpenCode

OpenCode loads plugins from two directories:
- `~/.config/opencode/plugins/` — global (all projects)
- `.opencode/plugins/` — per-project

**Option A: Quick install (global)**

```bash
# Link the plugin into OpenCode's global plugin directory
mkdir -p ~/.config/opencode/plugins
ln -sf /path/to/ph/hooks/opencode/ph-plugin.ts ~/.config/opencode/plugins/ph-plugin.ts
```

Or use the install script:

```bash
./hooks/opencode/install.sh              # global (default)
./hooks/opencode/install.sh --project    # current project only
```

**Option B: Manual copy**

```bash
cp hooks/opencode/ph-plugin.ts ~/.config/opencode/plugins/
```

The plugin is automatically loaded on the next OpenCode startup. No config changes needed — Bun handles TypeScript natively.

**Verify:**

```bash
# Start OpenCode — the plugin loads silently
opencode

# Check that prompts are being captured
ph search --tool opencode --limit 3
```

**Uninstall:**

```bash
rm ~/.config/opencode/plugins/ph-plugin.ts
```

---

### Hook Comparison

| Aspect | Claude Code | Gemini CLI | OpenCode |
|--------|------------|------------|----------|
| Hook mechanism | `Stop` shell script | `AfterAgent` shell script | JS/TS plugin |
| Data delivery | `transcript_path` (JSONL) | Direct JSON on stdin | Event hooks (`chat.message`, `experimental.text.complete`) |
| Prompt extraction | Parse JSONL with `jq` slurp | `jq .prompt` | `message.role === 'user'` parts |
| Response extraction | Last assistant text block | `jq .prompt_response` | `experimental.text.complete` accumulation |
| Async support | Yes (`async: true`) | Yes (`& + disown`) | Yes (Promise fire-and-forget) |
| Blocks AI exit? | Never | Never | Never |
| Install method | Symlink + settings.json | Symlink + settings.json | Copy plugin file to `plugins/` dir |

---

## 4. Installation

### From Source

```bash
git clone git@github.com:gi4nks/ph.git
cd ph
npm install
make build
make install    # installs the global 'ph' symlink
```

### Via npm

```bash
# Install globally:
npm install -g @gi4nks/ph
```

### Initial Configuration

```bash
# Set your Gemini API key (optional — Ollama works without it)
ph config set gemini-api-key "YOUR_KEY"

# Choose your analysis provider
ph config set analyze-provider ollama   # default, fully local
# ph config set analyze-provider gemini  # cloud alternative

# Enable background analysis
ph config set background-analysis true

# Optional: move the database to a custom location
ph config set db-path "/path/to/your/custom.db"
```

---

## 5. Usage

### Search

```bash
# Full-text search
ph search "how to refactor"

# Semantic search (vector similarity)
ph search --semantic "refactoring patterns"
```

### Interactive TUI

```bash
ph browse
```

Available hotkeys inside the TUI:

| Key | Action |
|-----|--------|
| `f` | Open filters panel |
| `e` | Edit prompt metadata (tags, notes) |
| `r` | Re-run selected prompt in your AI tool |
| `y` | Copy prompt to clipboard |
| `x` | Delete prompt from history |

### Export

```bash
# Export last 5 prompts as Markdown
ph export --format md --limit 5 > prompts.md
```

### Database Maintenance

```bash
# Remove short or old prompts
ph cleanup --min-length 20 --days 30

# Compact the database
ph vacuum

# Dry-run to preview what would be removed
ph cleanup --dry-run --days 60
```

---

## 6. Why Prompt History Matters

Every interaction with an AI tool is a unit of intellectual work. A well-crafted prompt encodes context, intent, and engineering decisions that took time to develop. Without capture, that work is lost the moment the session closes.

ph treats your prompt history as a first-class artifact: searchable, annotated, versioned with Git context, and available for re-use. Over time, your history becomes a personal knowledge base of how you think and work with AI tools.

> **The problem:** Manually saving prompts takes time, breaks flow, and rarely happens consistently. Without structure, even saved prompts become unsearchable noise.

> **The solution:** ph captures everything automatically via hooks, indexes it locally, and gives you semantic search so you can find what you need — even if you only remember the intent, not the exact wording.

---

---

## 7. Remote Server Setup

ph can act as a central sync hub for prompt history across multiple machines.

### Server Installation

```bash
# Install globally
sudo npm install -g @gi4nks/ph

# Verify
ph --help
```

### Ubuntu (systemd service)

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

Replace `<path-to-ph>` with the output of `which ph` on the server, and `<your-user>` with the user running the service.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ph.service
sudo systemctl status ph.service
sudo ufw allow 3001/tcp   # if firewall is enabled
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

### Client Setup

```bash
# Configure remote server URL
ph config set remote-url http://<server-ip>:3001
# Or via env var (takes precedence)
export PH_REMOTE_URL=http://<server-ip>:3001

# Sync commands
ph remote push    # send unsynced local prompts to server
ph remote pull    # fetch remote prompts since last pull
ph remote status  # show sync state
```

After `ph remote-url` is configured, every `ph log` automatically does a background push to the server (fire-and-forget, never blocks).

### Logs

```bash
# systemd
sudo journalctl -u ph.service -f

# launchd
cat /tmp/ph-server.log
```

---

## 8. Release Process

Releases are fully automated via **semantic-release** using conventional commits.

### How it works

1. All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

   ```
   feat: add new feature          → minor release (1.x.0)
   fix: resolve bug               → patch release (1.0.x)
   chore: bump deps               → no release
   BREAKING CHANGE: ...           → major release (x.0.0)
   ```

2. Push to `main` triggers GitHub Actions workflow `.github/workflows/release.yml`

3. The workflow runs:
   - `actions/checkout@v4` with full git history (`fetch-depth: 0`)
   - `actions/setup-node@v4` with Node 22
   - `npm ci` — clean install
   - `npm run build` — tsup bundle
   - `npx semantic-release` — analyzes commits, bumps version, updates CHANGELOG.md, creates git tag, publishes to npm

### npm publish details

- **OIDC Trusted Publishing**: Package is signed with provenance attestation via GitHub Actions OIDC token
- **Publisher identity**: `GitHub Actions <npm-oidc-no-reply@github.com>`
- **Registry**: `https://registry.npmjs.org/`
- **Access**: public

### Verify provenance

```bash
npm audit signatures
```

### Manual release (emergency)

Create a tag manually and push:

```bash
git tag v1.2.3
git push origin v1.2.3
```

---

## Repository

[https://github.com/gi4nks/ph](https://github.com/gi4nks/ph)
