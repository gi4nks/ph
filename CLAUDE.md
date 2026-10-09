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
- Use `make release-patch`, `make release-minor`, or `make release-major` to update the package version and lockfile locally.
- Do not manually modify the version in `package.json`.
- These Make targets do not create commits or tags and do not publish to npm.
- The GitHub Actions workflow runs `semantic-release` on pushes to `main`; it selects the release version from Conventional Commits and handles npm publication. Treat local version increments as preparation only.

## Maintenance Tasks

- Periodically run `ph cleanup --days 60` to keep history relevant.
- Run `ph vacuum` after large cleanups to compact the SQLite file.
