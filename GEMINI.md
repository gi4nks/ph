# GEMINI.md — Instructions for Gemini CLI

This file defines the directives for the Gemini agent in the `ph` project.

## Core Focus: Prompt History (ph)

`ph` is a local-first plain-text CLI and MCP server for capturing, searching, and recalling AI coding interactions and durable project memories. Database integrity and privacy boundaries are absolute priorities.

## LLM Provider System

- **Ollama**: Default provider (`http://localhost:11434`, `llama3.1:latest`) for local analysis and embeddings (`nomic-embed-text-v2-moe`).
- **Gemini**: Uses the `generativelanguage.googleapis.com` API (`gemini-2.5-flash`) with `x-goog-api-key` header auth.
- **OpenRouter & oMLX**: Supported via the zero-dependency OpenAI-compatible `fetch` adapter in `src/ai/openai-compatible.ts`.
- **Integration**: See `src/ai/provider.ts` for `LLMProvider` and `src/config/defaults.ts` for canonical defaults.

## Database & Persistence

- **WAL Mode**: The SQLite database (`~/.prompt_history.db`, schema v6) runs in WAL mode with a 10s busy timeout.
- **FTS5 & Vectors**: `prompts_fts` + `prompts_analysis_fts` power BM25/RRF text search; `sqlite-vec` (`vec_embeddings`) stores dynamic-dimension embeddings partitioned by `project` (`partition key`); `memories` + `memories_fts` + `memory_versions` store governed memories (including offline `hub_sync_status`).
- **Partial JSON indexes**: `idx_prompts_project` and `idx_prompts_sync_hash` index `json_extract` safely with `json_valid(metadata)`.

## Capture, Hooks, & Background Workers

- `ph hook <claude|codex|gemini|agy>` is the unified TypeScript capture entry point used by native hooks (`hooks/`).
- Detached workers (`_bg-analyze`, `_bg-memory`) serialize per-database work via `src/background/lock.ts` and must never block the wrapped AI CLI.
- `src/pty/wrapper.ts` lazy-loads optional `@lydell/node-pty` and forwards UTF-8 cleanly while preserving `SIGWINCH` resize signals.

## Semantic Versioning & Releases

- Releases are automated by `semantic-release` in GitHub Actions on pushes to `main`.
- **Git Workflow**:
  - Changes must follow **Conventional Commits** (`feat:`, `fix:`, `refactor:`, etc.).
  - Run `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `npm test` before pushing.
  - Do not commit manual version bumps outside the release automation.

## Maintenance

- Use `ph cleanup --dry-run` before deleting or archiving entries (`--retention`).
- Use `ph vacuum` to reclaim SQLite disk space after large cleanups.
- Monitor capture and background status with `ph status`.
