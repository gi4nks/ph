# CLAUDE.md — Instructions for Claude

This file provides specific context for using Claude within the `ph` project.

## Development Protocol

- **Build**: `make build` (uses `tsup` to generate `dist/cli.js`).
- **Dev**: `npm run dev -- <command>` (uses `tsx` for direct execution).
- **Language**: TypeScript (ESM). Imports must include the `.js` extension.

## Reference Architecture

- **Entry Point**: `src/cli.ts` uses manual command dispatch. With no arguments, PH explains setup-first capture. Run `ph setup` once, use supported AI tools normally, then use `ph search` when you need earlier work.
- **Database**: SQLite via `better-sqlite3` (schema v6); `PhDB` coordinates schema migrations and remains the compatibility facade, while `PromptRepository`, `MemoryRepository`, `ArchiveRepository`, and `SemanticIndex` (project-partitioned `sqlite-vec` vectors) own focused persistence behavior. Schema v4–v6 retain legacy memory and summary tables as migration evidence and track `capture_hash` and `hub_sync_status`.
- **Memory routing**: `src/memory/service.ts` owns local-versus-hub behavior and shared context retrieval for CLI and MCP. Automatic extraction is a separate hub-only worker scoped by `databaseId`.
- **Capture follow-ups & hooks**: `src/capture/lifecycle.ts` is the shared completion coordinator; `src/commands/hook.ts` (`ph hook <tool>`) provides the unified TypeScript hook entry point used by native shell hooks in `hooks/`.
- **AI & PTY**: `src/config/defaults.ts` centralizes OSS provider defaults; `src/ai/openai-compatible.ts` uses native `fetch`; `@lydell/node-pty` is an optional dependency lazy-loaded in `src/pty/wrapper.ts`.
- **HTTP service**: `src/server/request-handler.ts` handles transport (`GET /health` only is public) and delegates to separate memory and history route capabilities with distinct auth policies.
- **Runtime config**: `src/config/runtime.ts` owns environment-over-file resolution for hub, remote-sync, and server auth settings.
- **Hooks**: Scripts in `hooks/` are the entry points for transparent data capture.
- **User documentation**: Keep README, docs/ph-manual.md, docs/hooks.md, and docs/memory-hub.md aligned with observable behavior. The command output from `ph help --all` is the concise CLI reference; older specs and reports may describe retired workflows.

## Code Style

- Follow the rules defined in `eslint.config.js`.
- Maintain interfaces in `src/types.ts`.
- Keep the user-facing surface small. Maintenance and integration commands are documented under `ph help --all`.
- Always document changes to prompt metadata.

## Useful Agent Commands

```bash
npm run lint          # Linting check
npm run build         # Bundle the CLI
make release-patch    # Create a new patch release
ph --ph-role debug claude "test prompt" # Capture through an installed AI CLI
```

## Versioning Workflow

- Always use **Conventional Commits** (e.g., `feat: add semantic search`, `fix: resolved database bug`).
- Use `make release-patch`, `make release-minor`, or `make release-major` to update the package version and lockfile locally.
- Do not manually modify the version in `package.json`.
- These Make targets do not create commits or tags and do not publish to npm.
- The GitHub Actions workflow runs `semantic-release` on pushes to `main`; it selects the release version from Conventional Commits and handles npm publication. Treat local version increments as preparation only.

## Maintenance Tasks

- Before any cleanup, inspect `ph cleanup --dry-run`; cleanup can permanently delete interaction history.
- Run `ph vacuum` after an intentional large cleanup to compact SQLite.
