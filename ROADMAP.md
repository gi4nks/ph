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

### Product scope gate

Do not add user-facing commands, transports, or knowledge workflows until the
`prepare → work → close → promote` loop has been used on three real tasks across
different projects and the user can identify where it prevented repeated work.
Keep current commands available while their roles are clarified in the manual.

### Maintenance priorities

1. Run the model-backed retrieval evaluation against the configured embedding model and expand the judged query set using representative, privacy-safe examples.
2. Continue coverage of terminal capture, importer format changes, and remote sync failure recovery.
3. Split additional TUI behavior out of `BrowseApp` only when a clear testing seam improves locality.

The maintenance priorities are proposals, not shipped work. The product scope
gate is the current direction until the usage evidence is collected.
