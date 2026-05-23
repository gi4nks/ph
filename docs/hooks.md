# ph Hook System — Status Report

## Completed Hooks

| Tool | Type | File | Status |
|------|------|------|--------|
| Claude Code | Shell script (Stop hook) | `hooks/claude/ph-hook.sh` | ✅ |
| Gemini CLI | Shell script (AfterAgent hook) | `hooks/gemini/ph-hook.sh` | ✅ |
| OpenCode | JS/TS Plugin | `hooks/opencode/ph-plugin.ts` | ✅ |

## How Hooks Work

Each supported AI CLI tool exposes a native hook mechanism:

- **Claude Code** — `Stop` hook, triggered after each agent session completes.
  Reads the JSONL transcript, extracts last user prompt + assistant response, pipes to `ph log`.

- **Gemini CLI** — `AfterAgent` hook, triggered after each agent turn.
  Receives JSON with `prompt` and `prompt_response` fields directly, pipes to `ph log`.

- **OpenCode** — Plugin system with `chat.message` + `experimental.text.complete` hooks.
  Intercepts messages, pairs user prompts with streamed assistant responses, pipes to `ph log`.

All hooks run in the background (`& + disown` for shell scripts; Promise fire-and-forget for the plugin).
Never block the AI tool from exiting.

## Data Flow

```
AI CLI Tool
    ↓ (automatic hook after each exchange)
ph log (stdin JSON)
    ↓
SQLite (~/.prompt_history.db)
    ↓
background analysis (Ollama)
    ↓
metadata: project, language, role, tags, relevance
    ↓
ph browse / ph search / ph sessions
```

## Installation

See `docs/ph-manual.md` for detailed installation instructions per tool.
