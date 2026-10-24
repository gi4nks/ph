# SPEC-019 — Network, capture, and retrieval integrity

- **ID**: SPEC-019
- **Cluster**: Capture, Sync, Search, CLI
- **Status**: Implemented
- **Date**: 2026-10-24
- **Source**: Implemented network, sync, capture, and ranking contracts in `src/server/`, `src/sync/`, `src/capture/lifecycle.ts`, and related tests.

## Purpose

Close the remaining correctness and exposure gaps at PH's network and live-capture seams. The everyday local workflow stays simple; optional HTTP and sync paths must fail safely and preserve every acknowledged interaction.

## Scope and decisions

1. **HTTP exposure**: `ph server` listens on loopback by default and requires a configured API key before opening the listener. Every endpoint except `/health` requires that key. Health never returns the database path. Request bodies have a documented byte limit; malformed/oversized requests return bounded client errors without leaking internal exception text. A non-loopback deployment still requires explicit `--host` and the same authentication; cross-machine deployments require a trusted network or TLS termination.
2. **Push pagination**: local prompts are selected by monotonically increasing local row ID, not timestamp. The remote push cursor is scoped to both the normalized target URL and the persistent source database ID. Pages are split into HTTP bodies no larger than the server byte limit; the outer cursor advances only after every subpage and record is acknowledged or deduplicated. A failed subpage leaves the outer page retryable. Retrying is safe because `sync_hash` is idempotent.
3. **Pull pagination**: the server returns prompts in ascending remote row-ID order, a continuation cursor, and `hasMore`. The client persists an opaque target-and-local-database-scoped ID cursor only after a page is fully inserted or deduplicated. Switching either target or local database starts at row zero. Missing cursor fields are a compatibility error, not permission to silently fall back to a capped timestamp pull. Legacy timestamp cursors trigger a full idempotent scan from row zero.
4. **Capture completion**: hooks/direct `ph log`, inline wrapper, and interactive PTY wrapper share lifecycle initialization and configured analysis/remote-push effects. Invalid remote URLs mark the optional push failed without blocking local persistence or tool execution. Wrapper records identify a live capture owner; bulk sync stops before a live record so it cannot publish a partial response or advance past it. Markers from exited processes are cleared and the locally captured partial record remains eligible. Inline wrapper stdout is forwarded unchanged and persisted as the response; exit code is preserved. Live pushes have a five-second timeout. Empty responses are still captured and lifecycle work is dispatched.
5. **Search ranking**: raw prompt/response FTS and derived-metadata FTS retain separate indexes. Results use Reciprocal Rank Fusion (RRF, fixed `k=60`) across the two ranked lists, then timestamp descending and ID descending for deterministic ties. The raw-only relative BM25 order remains unchanged. Project-scoped CLI semantic search loads project embeddings through one metadata join instead of issuing one prompt query per embedding.
6. **Everyday help and docs**: short help lists optional `ph context "task"`; SPEC-010, SPEC-003, SPEC-005, SPEC-018, SPEC-ISSUES, README, manual, and AGENTS describe the implemented security, cursor, lifecycle, and ranking contracts.

## Acceptance criteria

- **G1 — Fail-closed HTTP**: Without `remoteApiKey`, `ph server` fails before listening. Default host is loopback. With a key, health returns status only; all data endpoints require the Bearer key. Invalid JSON returns 400, an oversized body returns 413, and internal errors do not expose exception details.
- **G2 — Lossless push**: Given more than one row-ID page, same-timestamp rows, late-imported lower-timestamp rows, bodies that exceed the byte limit, and a server response with per-record errors, every local row remains eligible until acknowledged. Live captures are held until completion; completed subpages checkpoint only after all subrequests are acknowledged. A database switch resets its cursor to zero. Retries do not duplicate acknowledged records.
- **G3 — Lossless pull**: Given over 10,000 remote rows, pagination imports all rows. Equal timestamps do not skip records. Legacy timestamp-only or database-unscoped config starts an idempotent full scan. A target or local database change starts at row zero. A server without continuation support fails clearly.
- **G4 — Shared live capture effects**: Given configured analysis and remote sync, direct log, inline wrapper, and PTY wrapper mark pending and dispatch the same effects. A malformed optional remote URL does not block local persistence or launching the wrapped CLI. A concurrent bulk push stops before active captures and resumes after completion; abandoned owner markers are reclaimed. Inline stdout is both displayed and stored as response. Exit status is preserved. Empty output is explicitly stored and still gets lifecycle completion.
- **G5 — Search ranking**: Raw-only queries preserve BM25 order; analysis-only queries find the correct source record; mixed-source queries follow RRF with deterministic tie breaks. Updating analysis metadata keeps the derived index fresh.
- **G6 — Product help**: Default help documents setup, search, show, and optional task context; status and maintenance remain advanced.
- **G7 — Migration and compatibility**: Existing prompt/response rows and sync dedup hashes remain intact. Legacy sync config replays idempotently instead of advancing a lossy timestamp cursor. HTTP/API clients receive an actionable upgrade error when pagination support is missing.
- **G8 — Bounded startup work**: Given a database whose search-text migration is complete, When another `PhDB` instance opens, Then it does not scan and parse all rows with empty derived metadata again. The database identity remains stable across reopen and differs across database files.
- **G9 — Scoped semantic loading**: Given embeddings across multiple projects, When CLI semantic search selects one project, Then only that project's vectors are loaded by a joined query and no per-vector `getById` lookup is issued.

## Verification

Verification completed: `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build` pass. Focused tests cover server startup/auth/body bounds, pull pagination over 10,000 records, partial push retry and late old-timestamp records, database-scoped push/pull cursors, active-capture deferral and stale-marker recovery, byte-sized push subpages, invalid-URL local capture and real inline child execution, legacy metadata backfill with blank rows and no repeated scan, project-scoped embedding loads, inline response/exit forwarding, and mixed-index ranking. HTML link validation and `git diff --check` pass.
