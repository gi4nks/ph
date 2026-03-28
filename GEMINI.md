# GEMINI.md — Instructions for Gemini CLI

This file defines the directives for the Gemini agent in the `ph` project.

## Core Focus: Prompt History (ph)

`ph` is an observability system for LLM prompts. Database integrity and metadata precision are absolute priorities.

## LLM Provider System

- **Ollama**: Default provider for embedding and local analysis.
- **Gemini**: Used for advanced analysis and embedding if configured.
- **Integration**: See `src/ai/provider.ts` for the `LLMProvider` interface.

## Database & Persistence

- **WAL Mode**: The SQLite database must always operate in WAL mode to support concurrent background analysis.
- **FTS5**: Used for full-text search.
- **Embeddings**: Saved as BLOB (Float32Array).

## Background Analysis Conventions

The `_bg-analyze` subcommand (in `src/cli.ts`) is invoked in a detached manner by `src/background/analyzer.ts`.
**Do not modify the child process behavior without testing the impact on parent process latency.**

## Hook Management

Hooks must be transparent. Every modification to `src/pty/wrapper.ts` must ensure that the `SIGWINCH` (terminal resize) signal is correctly propagated to the wrapped AI CLI.

## Prompt Snapshot Workflow

At the time of capture (`ph capture`), always collect:
1. Git Context (branch, diff).
2. Project Context (detected from `package.json` or similar).
3. Environment (CWD, Timestamp).

## Semantic Versioning & Releases

- The project uses `standard-version` to automate releases.
- **Git Workflow**:
  - Changes must follow **Conventional Commits**.
  - Before a release, ensure the build is correct (`make build`).
  - Run `make release-patch` (or minor/major) to update the version and `CHANGELOG.md`.
  - Do not commit version changes outside of the release process.
  - Pushing tags (`git push --follow-tags`) triggers the GitHub workflow for publication on GitHub Packages.
