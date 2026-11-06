# SPEC-020: Shared PH Memory Hub

**Status:** Implemented on the unified memory schema. Migration details are in SPEC-021.

## Goal

Provide one authenticated API for source-attributed shared memories without coupling it to raw prompt-history synchronization. Keep everyday capture local and make hub use an explicit client configuration.

## Behavior

### G1 — Create and retrieve shared memories

- `POST /api/memories` accepts a UUID, content, scope, kind, sensitivity, source, and optional project/source reference.
- Valid scopes are `work`, `personal`, and `project`; project scope requires a project name.
- The UUID maps to `memories.external_id`. Repeating the UUID with the same content/scope/project is idempotent; conflicting reuse is rejected.
- `POST /api/memories/search` supports query, scope, result limit, and explicit personal/sensitive inclusion.
- `GET /api/memories/{uuid}` returns one record. `DELETE` forgets it and `POST .../restore` restores it; status changes append the previous state to `memory_versions`.

### G2 — Require explicit sensitive consent

- A sensitive create requires both `sensitivity: "sensitive"` and `explicit_sensitive: true`; otherwise the server returns `403` without writing.
- Normal search, project context, MCP, and automatic extraction omit sensitive records. A deliberate CLI search can pass `--include-sensitive`.
- Automatic extraction is restricted to work/project scopes and rejects sensitive or personal candidates.

### G3 — Keep hub writes separate from transcript sync

- Client settings are `memory-hub-url` and `memory-hub-api-key`, with `PH_MEMORY_HUB_URL` and `PH_MEMORY_HUB_API_KEY` overrides.
- Memory endpoints authenticate with the memory-hub key; transcript sync uses `PH_SERVER_API_KEY` / `remote-api-key`.
- Configuring the hub does not call `/api/sync/push` and does not upload raw prompts through the memory path.
- With hub URL/key configured, `ph memory add|search|list|show|forget|restore` uses the shared hub. Without a hub, these commands use the local database.

### G4 — Automatically capture directly evidenced work memory

- When hub URL/key are configured and `memory-auto-capture` is not false, completed captured coding-agent interactions schedule a detached `_bg-memory` worker.
- The configured inference provider receives at most 4,000 characters from the prompt and response. The hub receives derived records only.
- At most two candidates can be saved. Each must include an exact supporting quote from the user prompt and represent a durable work preference or project decision.
- Stable UUIDs and `prompt:<id>:<ordinal>` source references make retries idempotent. Extraction status and memory IDs are stored with the local interaction.
- `ph memory undo <interaction-id>` forgets records created from that interaction. `ph memory retry <interaction-id>` retries extraction.
- A failed provider or hub request does not stop local capture.

### G5 — Provide an uncomplicated deployment

- `deploy/compose.yaml` runs the authenticated PH server with a persistent SQLite volume and loopback binding by default.
- `PH_SERVER_API_KEY` and `PH_MEMORY_HUB_API_KEY` are distinct deployment secrets. `deploy/.env.example` contains placeholders only.
- The generic deployment guide contains no private host names or credentials.

## Verification

Vitest covers migration preservation and idempotent opening in `src/db/__tests__/phdb.test.ts`, memory endpoint authorization/idempotency/sensitivity/forget/restore in `src/server/__tests__/server.test.ts`, and capture lifecycle behavior in `src/capture/__tests__/lifecycle.test.ts`.

## Current limits

- One shared memory bearer key; no per-client identities, connector scopes, or offline outbox.
- No email, calendar, browser, or personal-assistant connector.
- No hub-side inference worker or semantic memory index. Inference runs on the client.
- Hub search returns records from SQLite FTS5; raw prompt sync remains a separate optional feature.
