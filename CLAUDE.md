# CLAUDE.md — Instructions for Claude

This file provides specific context for using Claude within the `ph` project.

## Development Protocol

- **Build**: `make build` (uses `tsup` to generate `dist/cli.js`).
- **Dev**: `npm run dev -- <command>` (uses `tsx` for direct execution).
- **Language**: TypeScript (ESM). Imports must include the `.js` extension.

## Reference Architecture

- **Entry Point**: `src/cli.ts` handles command parsing via `commander`.
- **Database**: SQLite via `better-sqlite3`. Main tables: `prompts`, `embeddings`.
- **Hooks**: Scripts in `hooks/` are the entry points for transparent data capture.

## Code Style

- Follow the rules defined in `eslint.config.js`.
- Maintain interfaces in `src/types.ts`.
- Never remove existing features without authorization.
- Always document changes to prompt metadata.

## Useful Agent Commands

```bash
npm run lint          # Linting check
make build            # Complete build
make release-patch    # Create a new patch release
ph capture --role debug "test prompt" # Manual capture test
```

## Versioning Workflow

- Always use **Conventional Commits** (e.g., `feat: add semantic search`, `fix: resolved database bug`).
- Releases must be performed via `Makefile` targets (`make release-patch|minor|major`).
- Do not manually modify the version in `package.json`.
- Pushing tags triggers the GitHub Actions workflow for publication on the `@gi4nks` registry.
