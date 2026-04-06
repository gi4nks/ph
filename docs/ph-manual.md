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

### Hook Comparison

| Aspect | Claude Code | Gemini CLI |
|--------|------------|------------|
| Hook name | `Stop` | `AfterAgent` |
| Data delivery | `transcript_path` (JSONL file) | Direct JSON on stdin |
| Prompt extraction | Parse JSONL with `jq` slurp | `jq .prompt` field |
| Response extraction | Last assistant text block | `jq .prompt_response` field |
| Async support | Yes (`async: true` in config) | Yes (`& + disown` in script) |
| Blocks AI exit? | Never (exits `0`) | Never (exits `0`) |

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

### Via GitHub Packages

```bash
# Add to ~/.npmrc:
@gi4nks:registry=https://npm.pkg.github.com

# Then install globally:
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

## Repository

[https://github.com/gi4nks/ph](https://github.com/gi4nks/ph)
