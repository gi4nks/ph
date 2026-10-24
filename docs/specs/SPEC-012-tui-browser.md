# SPEC-012: Interactive History Browser (Retired)

- **ID**: SPEC-012
- **Cluster**: Retired UI
- **Status**: Retired on 2026-10-22
- **Implementation**: Removed from `src/ui/`; Ink/React runtime dependencies removed
- **Replacement**: `ph search`, `ph last`, and `ph context` print terminal text

## Decision

PH no longer ships the interactive history browser. The former browser combined
history filtering, details, metadata editing, starring, deletion, reruns,
provider selection, settings, and context launch in a keyboard-driven Ink/React
application. This breadth made PH feel like a second terminal application and
kept the user from the smaller jobs the product needs to do well.

The default command now prints a short guide. `ph search` is the primary way to
find past interactions; `ph last` and the legacy `ph browse` command print recent
interactions. `ph search -i` is accepted for compatibility and prints normal
search results. No search or memory data is changed by this UI retirement.

## Historical Context

The retired implementation supported list/detail panes, filters, settings,
star/edit/delete, rerun, context-aware chat, keyboard navigation, and an
alternate-screen terminal mode. Those interactions were removed with the UI
components and their PTY/filter tests. Equivalent history and knowledge remain
available through the CLI, MCP, and existing storage APIs where applicable.

The old keybindings, source locations, and interaction criteria are deliberately
not maintained as current requirements. Use `SPEC-001` for the current CLI
contract.
