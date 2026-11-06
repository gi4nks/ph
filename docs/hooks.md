# PH Capture Integrations

PH captures completed interactions from supported AI coding tools. The recommended setup is `ph setup`, which detects installed tools and configures their native integration. PH keeps the resulting history in its local SQLite database unless raw-history sync is separately configured.

## Supported integrations

| Tool | Integration | Capture point |
|---|---|---|
| Claude Code | Native `Stop` hook | Completed assistant turn |
| Codex CLI | Native `Stop` hook and Codex rollout importer | Completed turn from the supplied rollout transcript |
| Gemini CLI | Native `AfterAgent` hook | Completed agent turn |
| OpenCode | PH plugin installed in the user's OpenCode plugins directory | Completed user/assistant exchange |
| Google Antigravity (AGY) | Native `Stop` command hook; transcript importer also available | Completed agent turn / imported transcript |

## Install

```sh
ph setup
ph status
```

PH detects Claude, Codex, Gemini, OpenCode, and AGY executables on `PATH`. It installs or updates the selected integration and preserves unrelated settings. To target specific tools:

```sh
ph setup claude codex
ph setup opencode agy
```

Restart tools whose integration PH installed or updated. If no tool is detected, confirm its executable is on `PATH` or provide its supported name explicitly. The hook files are copied to `~/.ph/hooks`; the OpenCode plugin is installed under `~/.config/opencode/plugins`.

Source hook and plugin files live under `hooks/`. For normal installation, use `ph setup` rather than copying a hook script or editing tool settings by hand.

## How capture works

Each tool reports its completed interaction through its native hook/plugin format. PH's adapter extracts the user prompt and available assistant response, associates the working directory with the project, and writes the interaction through the PH capture pipeline. Codex capture parses the supplied rollout transcript and deduplicates turns. The Antigravity importer supports its transcript format and fallback JSONL transcript.

**OpenCode timing:** the current plugin keeps per-session state and writes the preceding prompt/response when the next user message arrives. If a session ends immediately after an assistant response, that final exchange may not yet be in PH. Import the local OpenCode history later with ph import opencode --dry-run, then rerun without --dry-run to backfill it.

Hook configuration is local to the user account. PH does not need an inference provider to capture or text-search interactions. If an optional inference provider, shared memory hub, or raw-history remote is configured, the corresponding follow-up work may run after capture; these are separate features and data flows described in the [user manual](ph-manual.md).

## Wrapper alternative

If a native hook is unavailable, invoke the tool through PH:

```sh
ph claude
ph codex --help
ph gemini "Explain this test failure"
```

PH forwards the tool arguments and captures the exchange. For extra metadata, pass wrapper flags before the tool name:

```sh
ph --ph-role review --ph-tag release claude
```

## Import prior sessions

Hooks capture new work. Import existing local histories separately, previewing the import first:

```sh
ph import codex --dry-run
ph import claude --dry-run
ph import gemini --dry-run
ph import opencode --dry-run
ph import agy --dry-run
```

Omit `--dry-run` to write the imported records. Use `--file <path>` for a specific transcript where supported and `--workdir <path>` to set its project directory. More import options are in the [user manual](ph-manual.md#10-import-existing-history).

## Troubleshooting

- Run `ph status` to check whether new interactions are arriving and whether optional follow-up work succeeded.
- After installation or update, restart the coding tool so it reloads its hook/plugin configuration.
- Check that PH is available to the hook process (`ph --help` from the same shell environment).
- Run `ph <tool>` as a wrapper to isolate native-hook setup from PH's capture and database path.
- Use `ph import <tool> --dry-run` to diagnose history parsing without changing the database.
