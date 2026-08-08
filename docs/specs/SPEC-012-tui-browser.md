# SPEC-012: TUI Browser

- **ID**: SPEC-012
- **Cluster**: TUI
- **Status**: Implemented (baseline)
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
Interactive exploration of the prompt history: list + detail panes, search,
filter panel, star/edit/rerun/delete, memory tab, settings. Ink + React.

## 2. Scope
- **In scope**: BrowseApp state machine, ListEntry/PreviewPane/Header/Footer/
  SearchBar components, keybindings, filter panel, themes.
- **Out of scope**: non-TUI output (src/display/print.ts), command handlers.
- **Entry points**: `ph` (no args), `ph browse`, `ph search -i`.

## 3. Data Model
- `Props` (src/ui/BrowseApp.tsx:784-788): db, initialTextFilter, initialFilters,
  onRerun.
- State: allEntries, refreshKey, archiveCount, textFilter, activeFilters,
  showFilterPanel, showSettings, pane/tab state (BrowseApp.tsx:791-810).
- `ActiveFilters` — tool/project/language/role/tag/starred/minQuality/
  minRelevance (populated from `search -i` flags, cli.ts:223-232).

## 4. Flows

### 4.1 Browse loop
1. `db.search({limit:1000})` seeds the list (BrowseApp.tsx:791).
2. `/` activates SearchBar → text filter → re-search; `f` opens FilterPanel
   (flat list with counts, Enter toggle, letter jump).
3. `Tab` switches pane in wide mode; `1/2/3` switch prompt/response/memory tabs.
4. `y` copy, `s` star, `e` edit metadata, `x` delete (DB + refresh),
   `r` rerun (onRerun → cli.ts spawns the tool), `C` chat mode (launch tool with
   project context), `o` settings.
5. ListEntry renders role-colored bar, analysis indicator ●/○, star, Q/R badges,
   summary line (ListEntry.tsx); Header shows counts + archive count
   (Header.tsx:archiveCount); session separators `╌╌ date ╌╌`.

### 4.2 Filter panel
Flat scrollable list of all filter options with `[N]` counts; Enter toggles a
filter; letter jump to category (BrowseApp.tsx FilterPanel, AGENTS.md).

## 5. Invariants & Business rules
- All mutations go through PhDB and refresh via `refreshKey`.
- The TUI is launched inside alt-screen (`\x1b[?1049h` … `l`) by cli.ts
  (SPEC-001) — cleanup in `finally`.
- Rerun is synchronous spawnSync after the TUI exits (cli.ts:176-181).

## 6. UI / UX surface
Keybindings (AGENTS.md table): ↑↓/PgUp/PgDn, Tab, 1/2/3, y/s/e/r/x, /, o, f, c,
q/ESC. Themes in src/ui/themes.ts.

## 7. Acceptance criteria (Given/When/Then)
- **G1**: Given a DB with entries, When BrowseApp mounts, Then the list shows the
  entries and Header shows the count (BrowseApp.tsx:791, Header.tsx).
- **G2**: Given `/` typed and a query, When the search applies, Then the list is
  filtered via db.search (BrowseApp.tsx SearchBar wiring).
- **G3**: Given `x` on a selected entry, When pressed, Then the entry is deleted
  via db.delete and the list refreshes (BrowseApp.tsx delete handler).
- **G4**: Given `s` on an entry, When pressed, Then `starred` toggles in
  metadata (BrowseApp.tsx star handler).
- **G5**: Given an entry with a project, When `C` is pressed, Then chat mode
  launches with project context injected (BrowseApp chat handler, SPEC-014).

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| Main app + filter panel + settings | src/ui/BrowseApp.tsx (1183 lines) |
| Entry list / detail | src/ui/ListEntry.tsx, PreviewPane.tsx |
| Header / footer / search | src/ui/Header.tsx, Footer.tsx, SearchBar.tsx |
| Themes | src/ui/themes.ts |
| Alt-screen bootstrap (×3) | src/cli.ts:159-186, 214-248, 373-396 |

## 9. Open questions / discrepancies
- BrowseApp is a monolith (SPEC-ISSUES-011); filter/search/chat behaviors are
  interleaved and untested.
- `refreshKey` increments trigger full re-search — no pagination past the 1000
  seed; huge histories truncate silently.
- React lint issues in BrowseApp/PreviewPane were reported pre-upgrade
  (AGENTS.md "Known Issues") — status after ink 7 upgrade unverified (lint runs
  clean now, but the rule set may have changed).

## 10. Related
- SPEC-001 (bootstrap), SPEC-005 (search backend), SPEC-002 (mutations),
  SPEC-014 (chat/context). No tests (SPEC-ISSUES-007).
