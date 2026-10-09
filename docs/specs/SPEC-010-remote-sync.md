# SPEC-010: Remote Sync (HTTP Server + Push/Pull)

- **ID**: SPEC-010
- **Cluster**: Sync
- **Status**: Implemented (baseline)
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
Cross-laptop prompt history sharing: a zero-dependency HTTP server (`ph server`)
plus `ph remote push|pull|status` with dedup via `sync_hash`
(sha256(`tool|prompt|response`)) and fire-and-forget background push after
`ph log`. Offline-first: the local SQLite DB stays the source of truth.

## 2. Scope
- **In scope**: HTTP endpoints, push/pull/status, dedup, background push,
  config/env precedence, CORS.
- **Out of scope**: authentication enforcement (see §9), conflict resolution
  beyond timestamp+hash, server persistence (uses the same PhDB).
- **Entry points**: `ph server [--port] [--host]`, `ph remote push|pull|status`,
  `PH_REMOTE_URL` env, `remoteUrl`/`remoteApiKey`/`remoteLastPush`/`remoteLastPull` config.

## 3. Data Model
- `sync_hash`: sha256 hex of `${tool}|${prompt}|${response}`, stored in
  metadata JSON under `$.sync_hash` (src/server/index.ts:104-108).
- Config: `remoteUrl`, `remoteApiKey`, `remoteLastPush`, `remoteLastPull`
  (src/config/index.ts:15-18).
- Env: `PH_REMOTE_URL` (precedence over config, src/commands/remote.ts:6-8).

## 4. Flows

### 4.1 Server (src/server/index.ts:9-164)
- CORS headers on every response (:15-17); OPTIONS → 204.
- `/health` → `{ status: 'ok', dbPath }` (:46-48).
- `POST /api/prompts/search|by-id|semantic` — search delegation (SPEC-005/008).
- `POST /api/sync/push` (:94-127): per prompt compute hash → skip if
  `getPromptBySyncHash` finds it → else insert with sync_hash in metadata.
- `POST /api/sync/pull` (:129-139): prompts since timestamp (or all), capped 10000.
- `POST /api/memories/search|summary` (:141-154); `GET /api/stats` (:156-161).

### 4.2 Push (src/commands/remote.ts:37-80)
`push` sends prompts since `remoteLastPush` (≤5000) to `/api/sync/push`;
on success updates `cfg.remoteLastPush` and saves.

### 4.3 Pull (src/commands/remote.ts:82-146)
`pull` fetches since `remoteLastPull`; dedups locally via `getPromptBySyncHash`;
advances `remoteLastPull` to the max timestamp.

### 4.4 Background push (src/commands/log.ts:65-69)
After each `ph log`, if a remote is configured, `pushToRemote(...).catch(() => {})`
— fire-and-forget, never blocks or crashes.

### 4.5 Status (src/commands/remote.ts:148+)
Shows remote URL, local total, last push/pull, pending count
(`getPromptCountSince(remoteLastPush)`).

## 5. Invariants & Business rules
- sync_hash is the dedup key on BOTH sides (server skip + client skip).
- `PH_REMOTE_URL` env wins over config (remote.ts:6-8).
- Background push swallows errors (`.catch(() => {})`).
- The server is read/write open — no auth check (SPEC-ISSUES-013).

## 6. UI / UX surface
CLI progress lines (`Pushing N prompts…`, `Imported: X, Skipped: Y`).

## 7. Acceptance criteria (Given/When/Then)
- **G1**: Given the same `tool|prompt|response`, When `sha256` runs, Then the
  same hash is produced both in push and server paths
  (src/server/index.ts:104, remote.ts:116).
- **G2**: Given an existing sync_hash in metadata, When `/api/sync/push` receives
  the entry, Then it is skipped (imported stays 0, skipped 1)
  (src/server/index.ts:104-106).
- **G3**: Given `remoteLastPush` set, When `push` runs, Then only prompts newer
  than the timestamp are sent (src/commands/remote.ts:39-43).
- **G4**: Given `PH_REMOTE_URL` env and a config remoteUrl, When `remoteUrl()`
  runs, Then the env value wins (src/commands/remote.ts:6-8).
- **G5**: Given `remoteLastPush` absent, When `status` runs, Then pending equals
  the local total (src/commands/remote.ts:151-156).
- **G6**: Given `POST /api/stats`, When the server handles it, Then
  total/totalMemories/byTool are returned (src/server/index.ts:156-161).

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| HTTP server + endpoints | src/server/index.ts:9-164 |
| Push/pull/status | src/commands/remote.ts:37-160 |
| Background push | src/commands/log.ts:65-85 |
| Config/env | src/config/index.ts:15-18, remote.ts:6-8 |
| Dedup primitive | src/db/index.ts:403-407 |

## 9. Open questions / discrepancies
- ~~sync_hash excludes args/workdir~~ Fixed 2026-08-08: shared `syncHash`
  helper (src/utils/syncHash.ts) — args included only when present, backward
  compatible with the legacy `tool|prompt|response` hash.
- ~~The server NEVER verifies `remoteApiKey`~~ Fixed 2026-08-08: auth gate in
  `createRequestHandler` (Bearer + timingSafeEqual) on every endpoint except
  /health when `remoteApiKey` is configured.
- `remoteLastPush` uses the CLIENT clock; clock skew between laptops breaks
  incremental sync.
- No pagination beyond the 10000/5000 caps; a laptop with >5000 unsynced
  prompts needs repeated pushes.

## 10. Related
- SPEC-002 (dedup/insert primitives), SPEC-005/008 (search endpoints),
  SPEC-015 (config). GWT tests target the deterministic parts (hash, dedup,
  since-window) — no network needed.
