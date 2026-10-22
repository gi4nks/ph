# SPEC-001: Architecture & CLI Dispatch

- **ID**: SPEC-001
- **Cluster**: Core
- **Status**: Implemented (plain-text daily workflow)
- **Date**: 2026-10-22
- **Source**: current repository behavior

## 1. Purpose

PH captures AI CLI interactions, finds earlier work, retrieves project context,
and supports explicit review of durable project knowledge. The everyday
interface is a small plain-text CLI; maintenance and integration commands are
available separately through `ph help --all`.

## 2. Scope

- **In scope**: CLI startup, concise and advanced help, command dispatch,
  compatibility aliases, wrapper fallback, and task-aware context retrieval.
- **Out of scope**: command internals outside context, MCP/HTTP protocols, and
  import formats.
- **Entry points**: `ph` prints a concise usage guide; `ph <tool> [args...]`
  wraps and captures an AI CLI; `search`, `context`, and `close` serve the daily
  history and memory workflows.

## 3. Dispatch Rules

1. Load config and resolve the database path.
2. With no arguments, print the short guide and exit without opening a database
   or starting an interactive UI.
3. `ph --help` and `ph help` print the short guide. `ph --help --all` and
   `ph help --all` print the full maintenance and integration catalog.
4. `context` and the legacy `prepare` command share task-aware retrieval and
   its recent-history fallback.
5. `close` defaults to reviewing the last three hours; explicit time ranges
   and prompt ID ranges remain supported.
6. `browse` remains a text-only compatibility alias for recent interactions.
   `search -i` remains accepted and prints normal text results.
7. Unknown commands fall through to transparent wrapper mode.

## 4. User-Facing Jobs

| Job | Primary command | Contract |
|---|---|---|
| Setup | `ph setup [tool...]` | Detect supported installed tools by default and install native capture integrations while preserving existing configuration |
| Capture | Native tool hook after setup; `ph <tool> [args...]` remains optional | Capture completed exchanges without changing the user's normal AI CLI invocation |
| Find | `ph search <query>` | Print matching history in plain text |
| Resume | `ph context "task"` | Optional explicit retrieval of project knowledge and relevant interactions |
| Review | `ph close` | Optional review of recent work; propose durable knowledge and require explicit approval |

Daily use requires setup once, then normal use of the supported AI CLI; search
is the only regular PH command. `prepare` is a compatibility alias for
`context`. There is no TUI in the runtime package. History can also be read
with `last` or the `browse` compatibility alias.

## 5. Invariants

- ESM only; relative imports use `.js` extensions.
- Existing advanced command names remain available unless separately removed.
- Capture and full-text search do not require an AI provider.
- `setup` writes only PH hook entries and preserves other JSON configuration;
  rerunning setup does not duplicate its entries.
- Setup does not import prior sessions or start an analysis provider.
- Retrieval labels its recent-history fallback; it does not silently claim
  semantic matching when embeddings are unavailable.
- `close` does not call a provider or mutate storage without a TTY and explicit
  approval of proposed knowledge.

## 6. Acceptance Criteria

- **G1**: Given `ph` in either a TTY or a pipe, when it starts, then it prints
  the same short guide, exits successfully, and emits no alternate-screen or
  interactive terminal controls.
- **G2**: Given `ph help --all`, when help is requested, then the full advanced
  command catalog is shown.
- **G3**: Given `ph context "cache timeout"` in a detected project, when semantic
  embeddings are unavailable, then recent project evidence is shown with an
  explicit fallback label and no database writes occur.
- **G4**: Given `ph prepare "cache timeout"`, when dispatched, then the same
  task-aware context path and output are used.
- **G5**: Given `ph close --dry-run` with no explicit range, when the project
  contains interactions from the last three hours, then they are selected and
  shown without provider calls or database writes.
- **G6**: Given `ph browse` or `ph search -i "cache"`, when invoked, then
  matching/recent plain-text results are printed without an interactive UI.
- **G7**: Given an existing Claude/Codex/Gemini JSON configuration, when
  `ph setup <tool>` runs, then its existing keys are preserved, one PH hook is
  installed, and rerunning setup does not duplicate that hook; OpenCode's
  existing `ph-plugin.ts` is left untouched if it differs from PH's plugin.
- **G8**: Given a supported tool name, when `ph setup` is called with explicit
  tool names, then only those integrations are installed; without names, only
  installed supported CLIs are detected and configured.

## 7. Implementation Map

| Concern | File(s) |
|---|---|
| Startup, help, dispatch | `src/cli.ts` |
| Search and `-i` compatibility | `src/commands/search.ts` |
| Task-aware context | `src/commands/context.ts`, `src/knowledge/task-context.ts` |
| Three-hour review default | `src/commands/close.ts` |
| Native capture setup | `src/commands/setup.ts` |
| CLI / operational memory tests | `src/commands/__tests__/operational-memory.test.ts` |

## 8. Related

`SPEC-003` (capture wrapper), `SPEC-005` (search), `SPEC-016` (operational
memory), and `SPEC-012` (retired history browser; retained as historical
documentation).
