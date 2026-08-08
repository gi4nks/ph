# SPEC-003: Capture Modes (PTY / Inline / Hooks / Log)

- **ID**: SPEC-003
- **Cluster**: Capture
- **Status**: Implemented (baseline)
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
The three ways a prompt+response reaches the DB: transparent PTY wrapping of an
interactive tool, inline (non-interactive) capture, and direct logging via hooks
or `ph log`. Plus the OpenCode plugin for real-time capture.

## 2. Scope
- **In scope**: runPTY (ESC/OSC state machine), runInline, resolveRealBinary,
  ph log command, hooks, opencode plugin.
- **Out of scope**: what happens after capture (analysis SPEC-006, background
  push SPEC-010).
- **Entry points**: `ph <tool> …` (wrapper), `ph log`, hook scripts, opencode plugin.

## 3. Data Model
- `PromptCallback(prompt, timestamp) => id` and `ResponseCallback(id, response)`
  (src/pty/wrapper.ts:4-5).
- Entry shape: `Omit<PromptEntry,'id'|'response'> & {response?: string}`
  (PhDB.insert, SPEC-002).

## 4. Flows

### 4.1 PTY wrapper (src/pty/wrapper.ts:23-169)
1. `pty.spawn(binary, args, {name:'xterm-256color', cols, rows, cwd, env})`.
2. Forward PTY output to stdout; buffer it as the "response".
3. stdin in raw mode; a byte-level ESC/CSI/OSC state machine (wrapper.ts:74-145)
   detects Enter (prompt capture), backspace, Ctrl-C/D, and ignores escape
   sequences. On Enter: finalize previous response, call `onPrompt`.
4. On PTY exit: finalize last response, restore stdin, resolve with exitCode.

### 4.2 Inline (src/runner/inline.ts:37)
`runInline` captures args → `extractPrompt(args)` (:8), runs the binary
non-interactively (spawnSync), records exit code, then `db.insert`.

### 4.3 Direct log (src/commands/log.ts:9-70)
`ph log --tool <t> --prompt <p> [--response <r>]` builds the entry (project
detection, language detection, topic extraction), inserts, then optionally
spawns background analysis (SPEC-006) and a fire-and-forget remote push
(SPEC-010).

### 4.4 Hooks + plugin
- `hooks/claude/ph-hook.sh`, `hooks/gemini/ph-hook.sh` — shell scripts invoked
  post-session; they pipe JSON to `ph log`.
- `hooks/opencode/ph-plugin.ts` — real-time capture via OpenCode hooks
  (`chat.message` + `experimental.text.complete`), pairs prompts with streamed
  responses, calls `ph log` in background; `hooks/opencode/install.sh`.

## 5. Invariants & Business rules
- PTY capture is byte-exact for prompts: ANSI sequences never leak into the
  prompt text (ESC state machine).
- `--ph-debug` writes a session log to `~/.ph_debug.log` via `debugLog`.
- Capture never blocks the wrapped tool (background processes for analysis/push).
- Binary resolution: `resolveRealBinary(tool)` maps known tool names
  (src/runner/inline.ts:15).

## 6. UI / UX surface
Transparent: the wrapped tool's own output is forwarded verbatim; ph itself
prints only capture feedback.

## 7. Acceptance criteria (Given/When/Then)
- **G1**: Given a PTY session where the user types `hello` and presses Enter,
  When the ESC state machine processes the bytes, Then `onPrompt` fires with
  `"hello"` (src/pty/wrapper.ts:87-98).
- **G2**: Given ANSI/OSC sequences (e.g. `\x1b]0;title\x07`), When the state
  machine runs, Then the sequences are consumed and never appended to
  `lineBuffer` (src/pty/wrapper.ts:114-143).
- **G3**: Given `ph log --tool claude --prompt "x"` without `--response`, When
  cmdLog runs, Then the entry is inserted with `response: ''` and project
  metadata (src/commands/log.ts, SPEC-002 G2).
- **G4**: Given `extractPrompt(["explain","goroutines"])`, When run, Then the
  joined prompt text is returned (src/runner/inline.ts:8-14).

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| PTY + ESC state machine | src/pty/wrapper.ts:23-169 |
| Inline runner + binary resolution | src/runner/inline.ts:8-60 |
| Direct log | src/commands/log.ts:9-85 |
| Hooks | hooks/claude/ph-hook.sh, hooks/gemini/ph-hook.sh |
| OpenCode plugin | hooks/opencode/ph-plugin.ts, install.sh |

## 9. Open questions / discrepancies
- `cleanLine` (wrapper.ts:7-10) trims whitespace — prompts containing leading/
  trailing spaces or multi-line pastes are collapsed; paste detection (bracketed
  paste) is not implemented.
- The PTY path is not exercised by any test (requires a PTY); the state machine
  logic is pure enough to unit-test with byte arrays.

## 10. Related
- SPEC-001 (wrapper-mode dispatch), SPEC-002 (insert), SPEC-006 (background
  analysis), SPEC-010 (background push). No tests exist (SPEC-ISSUES-007).
