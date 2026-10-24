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
  (`getPromptBySyncHash`, `getPromptsSince`, `getAllPrompts`). Fixed.
- **ISSUE-003 — `remoteLastPush` undeclared in PhConfig (FIXED 2026-08-08)** —
  `remote.ts` read/wrote `cfg.remoteLastPush` (push + status) while
  `PhConfig` (src/config/index.ts:5-22) declared only `remoteLastPull`; the
  field silently worked at runtime but was invisible to the type system. Fixed.

## Types / build

- **ISSUE-004 — node-pty typings blocked by package exports (FIXED 2026-08-08)** —
  `@lydell/node-pty` ships `node-pty.d.ts` but its package.json `exports` field
  breaks resolution under `moduleResolution: Bundler` → TS7016. Fixed with a
  minimal local declaration (src/pty/node-pty.d.ts) covering the used API. Fixed.
- **ISSUE-005 — TS6/@types-node-25 type breakage (FIXED 2026-08-08)** — the
  TS 5.9→6.0 upgrade broke 12 sites (Float32Array<ArrayBufferLike>, readSync
  4-arg, insert() response, private db, node-pty). All fixed; tsc green. Fixed.
- **ISSUE-006 — eslint 10 unusable with eslint-plugin-react 7.37.5** — peer range
  excludes eslint 10 (ERESOLVE). Resolved by pinning eslint back to ^9.39.4 and
  adding the missing `@eslint/js` devDep (eslint.config.js imported it but it was
  never in package.json → lint was completely broken). Fixed (downgrade).
- **ISSUE-007 — ZERO test files (FIXED 2026-10-09)** — baseline had no test
  files. Tests now cover database, search, memory, archive, sync, config,
  analysis, sessions, context, capture, importer formats, PTY response cleanup,
  HTTP endpoints, and MCP tool calls over an in-memory protocol transport. The
  retired Ink browser coverage is historical; current product tests target the
  plain-text CLI, capture adapters, and command modules.
- **ISSUE-016 — NON_PRINTABLE pattern matched plain words (FIXED 2026-08-08)** —
  the filter's non-printable regex `^[\x00-\x1f\x7f\x1b\[\]()#;\d;A-Za-z]*$`
  matched ANY all-alphanumeric string (e.g. "yes") because of `[A-Za-z\d]` in
  the class, classifying normal prompts as PTY noise. Fixed with a control-char
  lookahead (src/filter/index.ts:32-35). Found by the SPEC-004 GWT suite. Fixed.
- **ISSUE-017 — trivial filler list missed an Italian thank-you phrase (FIXED 2026-08-08)** —
  the Italian filler set lacked a common thank-you phrase;
  added (src/filter/index.ts:25). Found by the SPEC-004 GWT suite. Fixed.
- **ISSUE-018 — semantic project filter ran after global KNN limit (FIXED 2026-10-09)** —
  Context consumers fetched global nearest neighbors and filtered metadata
  afterward, which could omit relevant entries from the requested project.
  `PhDB.searchSemantic(query, limit, project)` now scopes results before the
  final limit; project-scoped searches inspect all stored vectors because
  sqlite-vec applies its KNN candidate limit before ordinary SQL filters.
  Fixed; performance trade-off documented in SPEC-005.

## Docs

- **ISSUE-008 — AGENTS.md stack table stale** — AGENTS.md says ink 6.8 / TS 5.9
  / eslint 9; package.json has ink 7.0.5 / TS 6.0.3 / eslint 9 (after revert).
  → docs update.
- **ISSUE-009 — `standard-version` still a devDep** — replaced by
  semantic-release (AGENTS.md) but still listed in package.json devDependencies.
  → chore cleanup.

## Design smells

- **ISSUE-010 — cli.ts TUI bootstrap duplicated 3× (FIXED 2026-08-08)** —
  extracted `openBrowser(db, props)` and `runRerun()` in `src/cli.ts`; default,
  `search -i`, and `browse` now share the alt-screen cleanup path. Fixed.
- **ISSUE-011 — BrowseApp remains a large module (RETIRED 2026-10-22)** — the
  history TUI and its Ink/React screens were removed when PH moved to the
  plain-text daily workflow. This finding no longer applies to the product.
- **ISSUE-012 — sync_hash excludes args/workdir (FIXED 2026-08-08)** — dedup
  hash was `sha256(tool|prompt|response)` duplicated inline in server
  (src/server/index.ts:104) and remote (remote.ts:116) — drift risk. Now a
  shared `syncHash` helper (src/utils/syncHash.ts) that includes `args` ONLY
  when present — backward compatible: entries without args keep the legacy
  hash (no mass re-push), entries with different args no longer collapse. Fixed.
- **ISSUE-013 — server auth was conditional and fail-open (FIXED 2026-10-24)** —
  `remoteApiKey` was sent by the client but the HTTP server never checked it.
  Now `createRequestHandler` (exported for tests) gates every endpoint except
  `/health` with `Authorization: Bearer <key>` (timingSafeEqual). Since
  SPEC-019, startup refuses to run without a key; default bind is loopback and
  `/health` returns status only (src/server/index.ts). Fixed.
- **ISSUE-014 — memories prompt_ids unused after summaries** — `prompt_ids` in
  `memories` (src/db/index.ts:109) is written but the summary merge path
  (project_summaries) tracks prompt_count instead; the timeline joins via
  project name. → verify whether prompt_ids is still load-bearing.
- **ISSUE-015 — `printResults`/`printEntry` display layer** — src/display/print.ts
  duplicates formatting logic that the TUI ListEntry also renders; two code paths
  for entry display can drift (e.g. badges, truncation rules).

## Follow-up findings (2026-10-24)

- **ISSUE-019 — sync cursors were shared across local databases (FIXED 2026-10-24)** —
  global configuration stored push/pull cursors keyed only by remote target, so
  switching `PH_DB` or `db-path` could skip records. Each SQLite file now has a
  persistent UUID included in both cursor comparisons; older cursor shapes replay
  idempotently from row zero (`src/db/index.ts:69-79,129`,
  `src/commands/remote.ts:44-49,118-126`). Regression coverage:
  `src/commands/__tests__/remote.test.ts` switches local database files and
  verifies both push and pull restart at row zero.
- **ISSUE-020 — invalid optional remote URL interrupted local capture (FIXED 2026-10-24)** —
  `syncTarget()` could throw before the local row was inserted or the wrapped
  CLI started. Remote URLs are validated when configured; environment overrides
  are handled as a failed remote effect while local capture continues
  (`src/sync/protocol.ts:25-40`, `src/capture/lifecycle.ts:24-40,63-68`,
  `src/commands/config.ts:174-175`). Regression coverage:
  `src/config/__tests__/config.test.ts`, `src/capture/__tests__/lifecycle.test.ts`,
  and `src/runner/inline.test.ts` verify validation, local persistence, and that
  the wrapped child still runs and its response is saved.
- **ISSUE-021 — bulk sync could publish a live partial response (FIXED 2026-10-24)** —
  wrappers persist prompts before their response is complete. Captures now carry
  a local owner PID; bulk push stops before a live capture and clears markers
  left by exited owners, preventing the partial and final versions from being
  imported as separate interactions (`src/commands/wrap.ts:53-63`,
  `src/runner/inline.ts:50-58`, `src/capture/lifecycle.ts:24-40,49-55`,
  `src/commands/remote.ts:68-104,205-212`). Regression coverage:
  `src/commands/__tests__/remote.test.ts` verifies a live partial response is
  withheld and only the completed response is pushed.
- **ISSUE-022 — fixed record-count pages could exceed the request-body cap (FIXED 2026-10-24)** —
  a 500-row request could exceed the server's 32 MiB limit and repeat unchanged.
  The client now splits outer pages by serialized byte size before sending and
  aggregates acknowledgements; an individually oversized record gets an
  explicit ID and size error (`src/sync/client.ts:9-29,32-50`,
  `src/sync/protocol.ts:4-5`). Regression coverage in
  `src/sync/__tests__/client.test.ts` verifies byte limits, record order,
  acknowledgement aggregation, and a clear error for a single oversized row.
- **ISSUE-023 — search metadata backfill scanned the prompt table on every open (FIXED 2026-10-24)** —
  rows with legitimately empty derived text were selected and parsed on each
  command. The backfill now runs once under an immediate transaction and records
  its completion in `ph_meta` (`src/db/index.ts:185-205`).
  `src/db/__tests__/phdb.test.ts` upgrades a legacy database with analyzed and
  blank rows, verifies searchable derived text, and ensures a later open does
  not query the blank rows again.
- **ISSUE-024 — project semantic search issued one query per vector (FIXED 2026-10-24)** —
  CLI search loaded all legacy embeddings and called `getById` for each vector
  to filter the current project. `SemanticIndex.loadProject()` now filters via
  one join, and the CLI loads only scoped vectors (`src/db/semantic-index.ts:43-50`,
  `src/db/index.ts:518-524`, `src/commands/search.ts:107-110`). Regression
  coverage in `src/db/__tests__/phdb.test.ts` checks project membership through
  the joined query; `src/commands/__tests__/search.test.ts` verifies the CLI
  chooses the scoped loader and never loads all vectors for a project search.
- **ISSUE-025 — remote database replacement is invisible to sync cursors (OPEN 2026-10-24)** —
  Push/pull cursors are keyed by normalized URL and local database UUID, but
  `/api/sync/pull` returns only row IDs and continuation state. If the remote
  SQLite database is replaced behind the same URL, a stored high cursor treats
  its new low IDs as already read; push likewise does not replay old local rows.
  Config also stores only one push and one pull cursor, so switching A→B→A
  replays A from row zero (idempotently, but with a full network scan).
  The global `remoteLastPush` and `remoteLastPull` fields can also report another
  target's time (`src/commands/remote.ts:111-119, 127-170, 183-199`,
  `src/server/index.ts:161-170`, `src/config/index.ts:23-26`). Add remote
  database identity to the protocol and scope all checkpoint/status state to it.
- **ISSUE-026 — semantic retrieval paths can disagree and vectors lack provenance (OPEN 2026-10-24)** —
  The CLI loads the legacy BLOB table, computes cosine similarity, and applies
  a fixed `0.3` cutoff, while context, HTTP, and MCP use `sqlite-vec`. The same
  query can return a different set and order by consumer. Stored vectors do not
  identify the configured embedding model; changing `ollama-embed-model` changes
  query vectors, and `ph embed-all` leaves existing vectors untouched
  (`src/commands/search.ts:95-120`, `src/db/semantic-index.ts:8-50`,
  `src/commands/embed-all.ts:6-32`, `src/config/index.ts:20`). Unify the search
  contract and make vector profile changes explicit.
- **ISSUE-027 — database migration work scales with history (OPEN 2026-10-24)** —
  Every `PhDB` constructor calls `migrate()`. Routine opens still select prompts
  missing `$schema_version` by parsing the JSON field and retry legacy column
  migrations. On the first open after the derived-search migration, the marker
  prevents repeats, but every blank `search_metadata` row is loaded and updated
  individually inside one immediate transaction. Large databases can pay O(n)
  startup work and hold a write lock during that first backfill
  (`src/db/index.ts:72-80, 164-205, 209-217`). Version and bound the migration
  steps, and avoid rewriting rows with no searchable analysis text.

## Issue-to-spec map

| Issue | Spec (fix target) | Status |
|---|---|---|
| 001 | SPEC-002 | Open (cleanup) |
| 002 | SPEC-002/010 | Fixed 2026-08-08 |
| 003 | SPEC-015 | Fixed 2026-08-08 |
| 004 | SPEC-003 | Fixed 2026-08-08 |
| 005 | SPEC-002 | Fixed 2026-08-08 |
| 006 | — (tooling) | Fixed 2026-08-08 (eslint 9 + @eslint/js) |
| 007 | SPEC-002/003/005/009/010/011/012/013/014 | Fixed 2026-10-09; test scope updated after TUI retirement |
| 008 | — (docs) | Open |
| 009 | — (chore) | Open |
| 010 | SPEC-001 | Fixed 2026-08-08 |
| 011 | SPEC-012 | Retired 2026-10-22 |
| 012 | SPEC-010 | Fixed 2026-08-08 (shared syncHash, args-aware, backward compatible) |
| 013 | SPEC-010/019 | Fixed 2026-10-24 (mandatory key, loopback default, health redaction) |
| 014 | SPEC-007 | Open |
| 015 | SPEC-012 | Open |
| 016 | SPEC-004 | Fixed 2026-08-08 |
| 017 | SPEC-004 | Fixed 2026-08-08 |
| 018 | SPEC-005/014 | Fixed 2026-10-09 |
| 019 | SPEC-010/019 | Fixed 2026-10-24 (persistent local database UUID scopes push/pull cursors) |
| 020 | SPEC-003/019 | Fixed 2026-10-24 (invalid optional remote URL cannot block local capture) |
| 021 | SPEC-003/010/019 | Fixed 2026-10-24 (active and abandoned capture markers handled before bulk push) |
| 022 | SPEC-010/019 | Fixed 2026-10-24 (push subpages bounded by serialized request bytes) |
| 023 | SPEC-002/019 | Fixed 2026-10-24 (one-time transactional search metadata backfill) |
| 024 | SPEC-005/019 | Fixed 2026-10-24 (project embedding load uses one metadata join) |
| 025 | SPEC-010/019 | Open (remote database replacement is not detected; timestamps are global) |
| 026 | SPEC-005/008 | Open (semantic search engines diverge; vectors lack model profile) |
| 027 | SPEC-002 | Open (routine database initialization repeats history scans) |
