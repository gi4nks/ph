# Project Context and Memory Roadmap

This document records the evolution of `ph` from a prompt history tool into a project-aware memory system. The phases below describe implemented capabilities; open decisions are listed at the end.

## Phase 0: Code and database foundations — Complete

- Split CLI commands into focused modules.
- Added project metadata and versioned metadata handling.
- Added persistent project memories and summary storage.
- Added native vector search through sqlite-vec.

## Phase 1: Project analysis and context — Complete

- Analysis extracts summaries, key insights, and technical decisions.
- Background analysis can process new captures without blocking the wrapped tool.
- `ph context` combines project summaries, memories, and related prompts.
- `ph chat` can add project context before launching a tool.
- Context retrieval and formatting are shared across CLI, chat, and MCP consumers.

## Phase 2: Memory lifecycle — Complete

- `project_summaries` keeps merged project knowledge with duplicate insight and decision removal.
- `memories` preserves an append-only analysis timeline.
- `ph memory-migrate` migrates earlier memory data into project summaries.
- Retention cleanup archives old prompts and removes expired archive entries according to configuration.

## Phase 3: MCP integration — Complete

The stdio MCP server exposes prompt search and lookup, project context and summaries, knowledge checks, decision saving, and project timelines.

## Phase 4: CLI and terminal workflows — Complete

- Search supports full-text and vector modes, filters, and archived prompts.
- The TUI supports browsing, filtering, editing metadata, starring, rerunning, and context-aware tool launch.
- Sessions and project timelines provide chronological views of captured work.

## Open decisions

- Evaluate embedding quality using the maintainer-judged dataset in `docs/evals/context-retrieval-golden.json` and `npm run eval:retrieval`.
- Decide whether a project-state fingerprint is useful for avoiding repetitive memory updates.
- Revisit more extensive `PhDB` decomposition if another storage adapter or a distinct migration seam is needed.

## Evaluation goals

- Measure retrieval recall and ranking quality using a reachable 768-dimensional embedding model.
- Review generated summaries and decisions against source interactions.
- Check that project-context queries can find relevant prior work without mixing other projects.
