# SPEC-016 — Operational memory workflow

**Status:** Implemented (2026-10-10)

## Purpose

Support a deliberate `prepare → work → close → promote` loop. Task retrieval is shared by CLI context, chat, and MCP knowledge checks. General context without a task remains non-semantic. Captured work only becomes curated knowledge after explicit user approval, and promoted memories keep verifiable prompt sources.

## Behavior

### `ph prepare`

- Accepts a task description and a project inferred from CWD or specified with `--project`.
- Uses shared `getProjectContext` retrieval with the task as a semantic query.
- If embeddings fail, labels the failure and falls back to recent project context.
- Renders source IDs and bounds the retrieved content using `--budget`; source references are preserved even if they exceed that target.
- Does not generate text or write to the database.

### `ph close`

- Requires exactly one explicit selection: `--since <duration>` or inclusive `--from <id> --to <id>`; selects only prompts tagged with the chosen project.
- Prints source prompt/response excerpts before generating proposals. `--dry-run` performs no generation and no database writes.
- Uses the configured analysis provider to propose zero or more knowledge entries. Every proposal must cite one or more selected prompt IDs.
- Requires an interactive TTY to approve or edit proposals. Proposals are staged until the user completes the review; quitting or interrupting before completion writes nothing.
- Checks for an interactive TTY before calling the analysis provider.
- On completed review, approved proposals append memories with cited `prompt_ids` and update `project_summaries` in one SQLite transaction. A failed write rolls back the whole approved batch.

### MCP

- `check_project_knowledge` uses the shared retrieval and formatter; embedding failure is labeled and falls back to recent context.
- `save_decision` accepts optional `promptIds`, validates existence and project ownership before writing, and stores them on the memory.

## GWT Acceptance

1. **Given** a task in a project with semantic embeddings, **when** `ph prepare` runs, **then** it returns scoped evidence and source IDs without changing prompt, memory, or summary data.
2. **Given** unavailable Ollama embeddings, **when** `ph prepare` runs, **then** it labels the fallback and renders recent context for the selected project.
3. **Given** selected prompt history, **when** `ph close --dry-run` runs, **then** it displays the selected excerpts without calling a model or writing memory/summary data.
4. **Given** generated proposals, **when** a cited ID is not in the selected prompt set, **then** the response is rejected before review or persistence.
5. **Given** a user approves proposals and finishes review, **when** review commits, **then** each approved memory stores the proposal's cited prompt IDs and updates the matching project summary.
6. **Given** `save_decision` receives a missing or other-project prompt ID, **when** called through MCP, **then** it returns an error and creates no memory.
7. **Given** MCP or CLI task retrieval for a project, **when** embeddings fail, **then** shared recent-context fallback is used and the degradation is visible.
8. **Given** a batch contains an invalid memory write, **when** promotion fails, **then** none of the batch's memories or summary updates persist.
9. **Given** `ph close` runs without an interactive TTY, **when** it is not a dry run, **then** it exits before calling the analysis provider.

## Verification

- Deterministic golden retrieval contract spans at least 12 judged queries across five projects; fixed-vector ranking test reports Recall@2/MRR without generation calls.
- Full local verification on 2026-10-10: 93 Vitest tests, ESLint, TypeScript, and tsup build passed.
