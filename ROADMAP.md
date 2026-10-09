# ph Roadmap

## Current capabilities

The original metadata, capture, search, analysis, context, and session milestones are implemented. Current capabilities include:

- Capture through wrappers, Claude Code/Codex CLI/Gemini CLI hooks, the OpenCode plugin, direct logging, and history import.
- Full-text and semantic search, project context retrieval, project summaries, and chronological memory history.
- Interactive browsing, filtering, metadata editing, starring, export, rerunning, and session grouping.
- MCP access to prompt history and project knowledge.
- Optional analysis, retention cleanup, and authenticated HTTP synchronization.

See [README.md](README.md) for current usage, [docs/ph-manual.md](docs/ph-manual.md) for setup and command details, and [docs/specs/SPEC-INDEX.md](docs/specs/SPEC-INDEX.md) for behavioral specifications.

## Next priorities

1. Run the model-backed retrieval evaluation against the configured embedding model and expand the judged query set using representative, privacy-safe examples.
2. Split additional TUI behavior out of `BrowseApp` when that creates a clear testing seam and improves locality.
3. Continue coverage of terminal capture, importer format changes, and remote sync failure recovery.
4. Decide whether project-state fingerprints should prevent duplicate memory updates.

These priorities are proposals, not shipped features.
