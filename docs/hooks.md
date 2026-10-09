# ph Hook System — Status Report

## Completed Hooks

| Tool | Type | File | Status |
|------|------|------|--------|
| Claude Code | Shell script (Stop hook) | `hooks/claude/ph-hook.sh` | Supported |
| Codex CLI | Shell script (Stop hook) | `hooks/codex/ph-hook.sh` | Supported |
| Gemini CLI | Shell script (AfterAgent hook) | `hooks/gemini/ph-hook.sh` | Supported |
| OpenCode | TypeScript plugin | `hooks/opencode/ph-plugin.ts` | Supported |

## How Hooks Work

Each supported AI CLI tool exposes a native hook mechanism:

- **Claude Code** — `Stop` hook, triggered after each agent session completes.
  Reads the JSONL transcript, extracts last user prompt + assistant response, pipes to `ph log`.

- **Codex CLI** — `Stop` hook receives the rollout `transcript_path`; the hook
  invokes `ph import codex --file` so each completed turn is paired from the
  transcript and duplicate turns are skipped.

- **Gemini CLI** — `AfterAgent` hook, triggered after each agent turn.
  Receives JSON with `prompt` and `prompt_response` fields directly, pipes to `ph log`.

- **OpenCode** — Plugin system with `chat.message` + `experimental.text.complete` hooks.
  Intercepts messages, pairs user prompts with streamed assistant responses, pipes to `ph log`.

Shell hooks return success even when capture fails; the Codex hook performs a
small local transcript import. The OpenCode plugin uses fire-and-forget logging.

## Data Flow

```
AI CLI Tool
    ↓ (automatic hook after each exchange)
ph log or ph import codex --file <transcript>
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

See `hooks/codex/README.md` for Codex installation and `docs/ph-manual.md` for
the other tool setup instructions.
