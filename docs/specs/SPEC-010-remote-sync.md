# SPEC-010 — Remote sync and HTTP server

- **ID**: SPEC-010
- **Cluster**: Sync
- **Status**: Implemented; lossless protocol defined by SPEC-019
- **Date**: 2026-10-24
- **Source**: `src/server/`, `src/commands/remote.ts`, `src/sync/`

## Purpose and scope

Share local PH history across trusted machines while each local SQLite database
remains usable offline. This spec covers server access, authentication, stable
pagination, deduplication, cursor persistence, and the status command.

## Server contract

- The default listener is `127.0.0.1`; a non-loopback host must be explicit.
- The server refuses to start without a non-empty `remote-api-key`.
- `/health` is public and returns `{ "status": "ok" }`. All data routes require
  `Authorization: Bearer <remote-api-key>` and compare credentials safely.
- Request bodies are limited to 32 MiB. Oversized and malformed requests return
  413 and 400 respectively. Internal errors are returned without exception
  details.
- `/api/sync/push` accepts up to 500 entries. It reports imported, duplicate,
  and rejected records separately; the client advances only after complete
  acknowledgement of the page.
- `/api/sync/pull` accepts `afterId` and `limit` (1–500), and returns entries in
  ascending database row-ID order with `hasMore` and `nextCursor`.

## Client contract

- Push selects local rows after a cursor scoped to the normalized target and
  persistent source database UUID. New imports receive higher IDs even when
  their timestamps are old, so the next page sees them. Active wrapper captures
  are not sent until completion; exited-owner markers are reclaimed. Byte-limited
  HTTP subpages may split one 500-row outer page, and the outer cursor advances
  only after every subpage is acknowledged.
- Pull reads remote row-ID pages, inserts or deduplicates every entry, then
  persists the cursor. Replaying a page is safe through `sync_hash`.
- Switching the normalized server target or local database starts from row
  zero. Legacy timestamp or database-unscoped cursors are ignored and trigger an
  idempotent full scan. A server without cursor response fields produces an
  actionable upgrade error.
- `PH_REMOTE_URL` overrides `remoteUrl`. Credentials are never included in the
  stored target identity.
- `ph remote status` reports counts after the current target's push cursor and
  the last successful push/pull times.

## Open reassessment finding

- **ISSUE-025**: cursor identity currently includes the normalized URL and local
  database UUID, but not the remote database generation. Replacing the remote
  SQLite file behind the same URL can make a high stored cursor skip the new
  database's lower row IDs. Config holds only one cursor per direction, so
  switching local databases and switching back triggers an idempotent full
  replay. Last-success timestamps are global config fields rather than
  target-scoped values. Add a remote identity handshake and persist state per
  complete source/target identity before treating cursors as durable across
  server restores.

## Acceptance criteria

- **G1**: Server startup requires an API key and defaults to loopback; health
  discloses no database path; data endpoints reject missing/incorrect keys.
- **G2**: Equal timestamps, old-timestamp late imports, and multiple pages do
  not skip rows.
- **G3**: A failed record prevents that page's cursor from advancing; retrying
  the page does not duplicate acknowledged records.
- **G4**: Pull pages are ordered and cursor-based; legacy timestamp configuration
  replays from the beginning; an old server fails clearly.
- **G5**: Malformed and oversized bodies return bounded client errors and do not
  expose internal exceptions.
- **G6**: `PH_REMOTE_URL` takes precedence and target changes restart sync from
  row zero.
- **G7**: Changing local database files restarts push and pull at row zero;
  byte-limited subpages all remain within the server request cap; live records
  are not bulk-pushed before response completion.

Focused server and protocol tests live under `src/server/__tests__/` and
`src/sync/`. SPEC-019 defines cross-cutting capture and ranking requirements.
