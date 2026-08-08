# SPEC-001: Architecture & CLI Dispatch

- **ID**: SPEC-001
- **Cluster**: Core
- **Status**: Implemented (baseline)
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
`ph` is a transparent observability layer for AI CLI tools: every prompt+response
is captured to a local SQLite DB (SPEC-002), analyzed (SPEC-006), and made
browsable via TUI (SPEC-012), CLI commands, MCP (SPEC-011) and HTTP (SPEC-010).
This spec covers the entry point and the command dispatch architecture.

## 2. Scope
- **In scope**: cli.ts main(), command resolution, wrapper-mode fallback, config
  loading order, TUI bootstrap.
- **Out of scope**: individual commands (their own specs), the TUI internals.
- **Entry points**: `ph` (no args → TUI), `ph <command>`, `ph <tool> "prompt"` (wrapper).

## 3. Data Model
- `argv` split into `command` (first non-flag arg) + `cmdArgs` + `preArgs`
  (ph-specific flags before the command, e.g. `--ph-tag`).
- `PhConfig` (src/config/index.ts:5) loaded before dispatch; `geminiApiKey`
  is copied to `process.env.GEMINI_API_KEY` (cli.ts:153-155).
- DB path resolution: `PH_DB` env > `cfg.dbPath` > `defaultPath()`
  (cli.ts:157).

## 4. Flows

### 4.1 Dispatch (src/cli.ts:148-441)
1. Load config; set env; resolve dbPath.
2. No args + TTY → render BrowseApp in alt-screen, wait for exit, optional
   rerun (cli.ts:159-186).
3. Find first non-flag arg; flags `--ph-tag`/`--ph-role` consume their value
   (cli.ts:190-203).
4. Switch on the command name: ~25 cases (search, context, last, sessions,
   stats, cluster, analyze*, cleanup*, star, export, import, analyze, mcp,
   server, remote, log, embed-all, vacuum, config, _bg-analyze, browse, chat,
   timeline, ollama-models, help).
5. Unknown command → wrapper mode: `cmdWrap(dbPath, command, [...preArgs,
   ...cmdArgs], cfg)` (cli.ts:436-439).

### 4.2 Wrapper mode (SPEC-003)
Unknown first arg = a real binary (`claude`, `gemini`, …): run it and capture.

## 5. Invariants & Business rules
- ESM only, `.js` import extensions (package.json `"type": "module"`).
- Manual arg parsing (`parseFlags`, src/commands/_utils.ts:1) — no commander.
- Every command handler owns its `PhDB` instance and closes it
  (`new PhDB(...)` … `db.close()` per case).
- `main()` catches everything: `ph: <message>` on stderr, exit 1 (cli.ts:443-446).

## 6. UI / UX surface
USAGE text is a single ~200-line template literal (cli.ts:38-140); `ph --help`,
`-h`, `help` and non-TTY no-arg all print it.

## 7. Acceptance criteria (Given/When/Then)
- **G1**: Given `ph search foo`, When main() runs, Then the `search` case opens a
  PhDB, calls `cmdSearch` and closes the DB (cli.ts:250-253).
- **G2**: Given `ph claude "hello"` (unknown command), When main() runs, Then
  `cmdWrap` receives tool=`claude` and args `["hello"]` (cli.ts:436-439).
- **G3**: Given `ph` with no args on a non-TTY stdin, When main() runs, Then the
  USAGE text is printed and the process exits 0 (cli.ts:183-186).
- **G4**: Given `--ph-tag auth claude "x"`, When parsing, Then `auth` is consumed
  as the tag value and `claude` is the command (cli.ts:192-194).

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| Entry + dispatch + USAGE | src/cli.ts:38-441 |
| Config load/save | src/config/index.ts:26-40 |
| Flag parsing | src/commands/_utils.ts:1-30 |
| TUI bootstrap (×3 duplicated) | src/cli.ts:159-186, 214-248, 373-396 (SPEC-ISSUES-010) |

## 9. Open questions / discrepancies
- TUI bootstrap duplicated 3× (SPEC-ISSUES-010).
- `--ph-debug` is listed in USAGE but only consumed by wrapper paths (inline/pty
  debug logs); no validation if used with non-wrapper commands.

## 10. Related
- All other specs (commands dispatch into each), SPEC-012 (BrowseApp),
  SPEC-003 (wrapper mode). No tests exist yet (SPEC-ISSUES-007).
