# CLAUDE.md — Instructions for Claude

This file provides specific context for using Claude within the `ph` project.

## Development Protocol

- **Build**: `make build` (uses `tsup` to generate `dist/cli.js`).
- **Dev**: `npm run dev -- <command>` (uses `tsx` for direct execution).
- **Language**: TypeScript (ESM). Imports must include the `.js` extension.

## Reference Architecture

- **Entry Point**: `src/cli.ts` uses manual command dispatch. With no arguments, PH explains setup-first capture. Run `ph setup` once, use supported AI tools normally, then use `ph search` when you need earlier work.
- **Database**: SQLite via `better-sqlite3`; `PhDB` coordinates schema migrations and remains the compatibility facade, while `PromptRepository`, `MemoryRepository`, `ArchiveRepository`, and `SemanticIndex` own focused persistence behavior. Schema v4 retains legacy memory and summary tables as migration evidence.
- **Memory routing**: `src/memory/service.ts` owns local-versus-hub behavior and shared context retrieval for CLI and MCP. Automatic extraction is a separate hub-only worker.
- **Capture follow-ups**: `src/capture/lifecycle.ts` is the shared completion coordinator; memory scheduling and raw-history delivery live in focused follow-up modules.
- **HTTP service**: `src/server/request-handler.ts` handles transport and delegates to separate memory and history route capabilities with distinct auth policies.
- **Runtime config**: `src/config/runtime.ts` owns environment-over-file resolution for hub, remote-sync, and server auth settings.
- **Hooks**: Scripts in `hooks/` are the entry points for transparent data capture.
- **User documentation**: Keep README, docs/ph-manual.md, docs/hooks.md, docs/memory-hub.md, and docs/ph-feature-catalog.html aligned with observable behavior. The command output from `ph help --all` is the concise CLI reference; older specs and reports may describe retired workflows.

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
