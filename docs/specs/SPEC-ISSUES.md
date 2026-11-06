# SPEC-ISSUES — ph cross-cutting findings

Historical discrepancy ledger from reverse-engineering the PH baseline,
updated through 2026-11-06. Some detailed entries preserve the paths and behavior
observed at the time and are not current open findings. The status table at the
end is authoritative for whether a finding remains open.

## Database

- **ISSUE-001 — `response` column created by ALTER, not CREATE TABLE (RESOLVED 2026-11-06)** —
  the current `prompts` table definition creates `response` directly
  (src/db/index.ts:135-155); the conditional ALTER only adds it to legacy
  databases that do not yet have the column. Schema-v4 databases take the
  version-match startup path and do not repeat that migration.
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

- **ISSUE-008 — AGENTS.md stack table stale (RESOLVED 2026-11-06)** — the
  current project guide now documents the actual TypeScript/SQLite CLI
  architecture and no longer describes the retired Ink application.
- **ISSUE-009 — `standard-version` still a devDep (RESOLVED 2026-11-06)** —
  neither package.json nor package-lock.json contains this dependency; releases
  use semantic-release.

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
  Now `createRequestHandler` (exported for tests) gates every data endpoint
  with its corresponding bearer key (timingSafeEqual); `/health` is public
  and returns status only. Startup requires at least one of the history-service
  or memory-hub keys; the default bind is loopback (src/server/index.ts). Fixed.
- **ISSUE-014 — memory prompt provenance (RESOLVED 2026-11-06)** — prompt_ids
  are validated and retained as source references for unified memories. Legacy
  project_summaries remain historical migration data; they are not the current
  memory write path.
- **ISSUE-015 — duplicate CLI/TUI display formatting (RETIRED 2026-10-22)** —
  the TUI ListEntry path was removed with the browser. Current plain-text
  formatting is implemented by src/display/print.ts and interaction/detail.ts.

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
- **ISSUE-025 — remote database replacement is invisible to sync cursors (RESOLVED 2026-11-05)** —
  Remote database identity `databaseId` added to the sync push/pull protocol.
  Checkpoints track `remoteDatabaseId` alongside local `databaseId`. Target state
  is isolated per remote URL in config, and checkpoints reset automatically when
  the remote database generation changes.
- **ISSUE-026 — semantic retrieval paths can disagree and vectors lack provenance (RESOLVED 2026-11-05)** —
  Retired legacy in-memory BLOB embeddings. All consumers (CLI, MCP, context)
  standardized on `sqlite-vec`. Model provenance is tracked in `ph_meta` via
  `embedding_model`, with `EmbeddingModelMismatchError` and graceful FTS5 fallback
  plus `--force` rebuild flag.
- **ISSUE-027 — database migration work scales with history (RESOLVED 2026-11-06)** —
  The current schema version is 4. Startup takes the version-match fast path;
  one-time migration preserves legacy memory provenance, versions, and summary
  tables. SPEC-021 documents the migration contract.

## Issue-to-spec map

| Issue | Spec (fix target) | Status |
|---|---|---|
| 001 | SPEC-002 | Fixed 2026-11-06 (fresh schema includes response; conditional legacy backfill only) |
| 002 | SPEC-002/010 | Fixed 2026-08-08 |
| 003 | SPEC-015 | Fixed 2026-08-08 |
| 004 | SPEC-003 | Fixed 2026-08-08 |
| 005 | SPEC-002 | Fixed 2026-08-08 |
| 006 | — (tooling) | Fixed 2026-08-08 (eslint 9 + @eslint/js) |
| 007 | SPEC-002/003/005/009/010/011/012/013/014 | Fixed 2026-10-09; test scope updated after TUI retirement |
| 008 | — (docs) | Fixed 2026-11-06 (current project guide) |
| 009 | — (chore) | Fixed 2026-11-06 (not present in package manifests) |
| 010 | SPEC-001 | Fixed 2026-08-08 |
| 011 | SPEC-012 | Retired 2026-10-22 |
| 012 | SPEC-010 | Fixed 2026-08-08 (shared syncHash, args-aware, backward compatible) |
| 013 | SPEC-010/019 | Fixed 2026-10-24 (at least one route key, per-route auth, loopback default, health redaction) |
| 014 | SPEC-007 | Fixed 2026-11-06 (prompt provenance is active in unified memories) |
| 015 | SPEC-012 | Retired 2026-10-22 with the TUI |
| 016 | SPEC-004 | Fixed 2026-08-08 |
| 017 | SPEC-004 | Fixed 2026-08-08 |
| 018 | SPEC-005/014 | Fixed 2026-10-09 |
| 019 | SPEC-010/019 | Fixed 2026-10-24 (persistent local database UUID scopes push/pull cursors) |
| 020 | SPEC-003/019 | Fixed 2026-10-24 (invalid optional remote URL cannot block local capture) |
| 021 | SPEC-003/010/019 | Fixed 2026-10-24 (active and abandoned capture markers handled before bulk push) |
| 022 | SPEC-010/019 | Fixed 2026-10-24 (push subpages bounded by serialized request bytes) |
| 023 | SPEC-002/019 | Fixed 2026-10-24 (one-time transactional search metadata backfill) |
| 024 | SPEC-005/019 | Fixed 2026-10-24 (project embedding load uses one metadata join) |
| 025 | SPEC-010/019 | Fixed 2026-11-05 (databaseId in protocol, multi-target cursor isolation) |
| 026 | SPEC-005/008 | Fixed 2026-11-05 (sqlite-vec unified, model provenance in ph_meta) |
| 027 | SPEC-002/021 | Fixed 2026-11-06 (schema v4, versioned startup, lossless unified-memory migration) |
