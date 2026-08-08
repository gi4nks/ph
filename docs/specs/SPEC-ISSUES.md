# SPEC-ISSUES — ph cross-cutting findings

Discrepancies, dead code, and open questions found while reverse-engineering
the ph baseline (2026-08-08). Each entry cites `path:line` evidence.
Status: Open → assigned SPEC / fixed.

## Database

- **ISSUE-001 — `response` column created by ALTER, not CREATE TABLE** — the
  `prompts` CREATE TABLE (src/db/index.ts:55-66) omits `response`; the column is
  added later by a migration `ALTER TABLE prompts ADD COLUMN response`
  (src/db/index.ts:143-146) that runs on every open. Works, but a fresh DB goes
  through two steps and the schema is documented with `response` in CREATE
  (AGENTS.md). → cleanup candidate.
- **ISSUE-002 — Private `db` accessed from server/remote (FIXED 2026-08-08)** —
  `server/index.ts` used `db.db.prepare(...)` in 6 places and `remote.ts` in 1
  (health, sync push/pull, stats, status). Fixed by adding public PhDB methods
  (`getPromptCountSince`, `getStats`, `dbPath`) and reusing existing ones
  (`getPromptBySyncHash`, `getPromptsSince`, `getAllPrompts`). ✅ Fixed.
- **ISSUE-003 — `remoteLastPush` undeclared in PhConfig (FIXED 2026-08-08)** —
  `remote.ts` read/wrote `cfg.remoteLastPush` (push + status) while
  `PhConfig` (src/config/index.ts:5-22) declared only `remoteLastPull`; the
  field silently worked at runtime but was invisible to the type system. ✅ Fixed.

## Types / build

- **ISSUE-004 — node-pty typings blocked by package exports (FIXED 2026-08-08)** —
  `@lydell/node-pty` ships `node-pty.d.ts` but its package.json `exports` field
  breaks resolution under `moduleResolution: Bundler` → TS7016. Fixed with a
  minimal local declaration (src/pty/node-pty.d.ts) covering the used API. ✅ Fixed.
- **ISSUE-005 — TS6/@types-node-25 type breakage (FIXED 2026-08-08)** — the
  TS 5.9→6.0 upgrade broke 12 sites (Float32Array<ArrayBufferLike>, readSync
  4-arg, insert() response, private db, node-pty). All fixed; tsc green. ✅ Fixed.
- **ISSUE-006 — eslint 10 unusable with eslint-plugin-react 7.37.5** — peer range
  excludes eslint 10 (ERESOLVE). Resolved by pinning eslint back to ^9.39.4 and
  adding the missing `@eslint/js` devDep (eslint.config.js imported it but it was
  never in package.json → lint was completely broken). ✅ Fixed (downgrade).
- **ISSUE-007 — ZERO test files** — no `*.test.ts` anywhere; `vitest run` exits
  with "No test files found". ⚠️ **Partially fixed 2026-08-08**: 51 GWT tests
  added (SPEC-002/004/005/006/007/009/010/014/015) — capture/PTY, MCP, server,
  TUI and importers still uncovered.
- **ISSUE-016 — NON_PRINTABLE pattern matched plain words (FIXED 2026-08-08)** —
  the filter's non-printable regex `^[\x00-\x1f\x7f\x1b\[\]()#;\d;A-Za-z]*$`
  matched ANY all-alphanumeric string (e.g. "yes") because of `[A-Za-z\d]` in
  the class, classifying normal prompts as PTY noise. Fixed with a control-char
  lookahead (src/filter/index.ts:32-35). Found by the SPEC-004 GWT suite. ✅ Fixed.
- **ISSUE-017 — trivial filler list missing 'grazie' (FIXED 2026-08-08)** —
  the Italian filler set (che dici/dimmi/vai/procedi/aspetta) lacked 'grazie';
  added (src/filter/index.ts:25). Found by the SPEC-004 GWT suite. ✅ Fixed.

## Docs

- **ISSUE-008 — AGENTS.md stack table stale** — AGENTS.md says ink 6.8 / TS 5.9
  / eslint 9; package.json has ink 7.0.5 / TS 6.0.3 / eslint 9 (after revert).
  → docs update.
- **ISSUE-009 — `standard-version` still a devDep** — replaced by
  semantic-release (AGENTS.md) but still listed in package.json devDependencies.
  → chore cleanup.

## Design smells

- **ISSUE-010 — cli.ts TUI bootstrap duplicated 3×** — the alt-screen
  `\x1b[?1049h` + render(BrowseApp) + rerun block is copy-pasted for the default
  (cli.ts:159-186), `search -i` (cli.ts:214-248) and `browse` (cli.ts:373-396)
  with only the initial props differing. → extract a `openBrowser(db, props)` helper.
- **ISSUE-011 — BrowseApp is a 1183-line monolith** — all views (list, detail,
  filter panel, settings) live in one component (src/ui/BrowseApp.tsx) with
  components extracted only for Header/Footer/ListEntry/PreviewPane/SearchBar.
  → component extraction follow-up.
- **ISSUE-012 — sync_hash excludes args/workdir** — dedup hash is
  sha256(`tool|prompt|response`) (src/server/index.ts:104, remote.ts:116): two
  runs of the same tool+prompt with different args collapse to one entry on pull.
  → include args in the hash (behavior change — verify before applying).
- **ISSUE-013 — server auth is declared but never enforced** — `remoteApiKey`
  config exists and the client sends `Authorization: Bearer` (remote.ts:96) but
  the HTTP server never checks the header (src/server/index.ts has no auth
  branch). Anyone reaching the port can read/write the prompt DB.
- **ISSUE-014 — memories prompt_ids unused after summaries** — `prompt_ids` in
  `memories` (src/db/index.ts:109) is written but the summary merge path
  (project_summaries) tracks prompt_count instead; the timeline joins via
  project name. → verify whether prompt_ids is still load-bearing.
- **ISSUE-015 — `printResults`/`printEntry` display layer** — src/display/print.ts
  duplicates formatting logic that the TUI ListEntry also renders; two code paths
  for entry display can drift (e.g. badges, truncation rules).

## Issue-to-spec map

| Issue | Spec (fix target) | Status |
|---|---|---|
| 001 | SPEC-002 | Open (cleanup) |
| 002 | SPEC-002/010 | ✅ Fixed 2026-08-08 |
| 003 | SPEC-015 | ✅ Fixed 2026-08-08 |
| 004 | SPEC-003 | ✅ Fixed 2026-08-08 |
| 005 | SPEC-002 | ✅ Fixed 2026-08-08 |
| 006 | — (tooling) | ✅ Fixed 2026-08-08 (eslint 9 + @eslint/js) |
| 007 | SPEC-002/005/009/010 | ⚠️ Partially fixed 2026-08-08 (51 tests; capture/MCP/server/TUI uncovered) |
| 008 | — (docs) | Open |
| 009 | — (chore) | Open |
| 010 | SPEC-001 | Open |
| 011 | SPEC-012 | Open |
| 012 | SPEC-010 | Open (behavior change) |
| 013 | SPEC-010 | Open (security) |
| 014 | SPEC-007 | Open |
| 015 | SPEC-012 | Open |
| 016 | SPEC-004 | ✅ Fixed 2026-08-08 |
| 017 | SPEC-004 | ✅ Fixed 2026-08-08 |
