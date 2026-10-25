# SPEC-020: Governed Personal Memory Hub

**Status:** Implemented for automatic coding-agent memory capture and governed CLI/MCP access; broader connectors and offline policies remain open.

## Goal

Store user-governed, source-attributed memories in the PH service and let configured PH clients read and manage them without coupling this API to raw prompt-history synchronization.

## Behavior

### G1 — Create a canonical memory

- `POST /api/memories` accepts a UUID, content, scope, kind, sensitivity, source, and optional source reference.
- Supported scopes are `work`, `personal`, and `project`.
- Repeating the same UUID and record is idempotent. Reusing it for different content returns `409`.
- Content is limited to 8,000 characters; source references to 500 characters.

### G2 — Require explicit consent for sensitive writes

- `sensitivity: "sensitive"` without `explicit_sensitive: true` returns `403` and writes nothing.
- Sensitive records are omitted from search by default.
- `ph memory search --include-sensitive` explicitly includes them.
- `ph context` queries only `work` and `project` scope and never requests sensitive records.

### G3 — Find and inspect memories

- `POST /api/memories/search` searches active records by text and optional scope, with a 1–100 result limit.
- `GET /api/memories/{uuid}` returns one record or `404`.
- All data routes require the configured Bearer key.

### G4 — Forget and restore

- `DELETE /api/memories/{uuid}` changes an active record to forgotten.
- The previous state is appended to `personal_memory_versions` in the same transaction.
- `POST /api/memories/{uuid}/restore` reactivates it and records the forgotten state.
- Forgotten records are excluded from default search.

### G5 — Keep the memory hub separate from transcript sync

- Client configuration uses `memory-hub-url` and `memory-hub-api-key`, with `PH_MEMORY_HUB_URL` and `PH_MEMORY_HUB_API_KEY` overrides.
- These settings do not trigger `/api/sync/push` and do not transmit raw prompts or responses.
- An approved `ph close` proposal is copied to the hub with prompt IDs in `source_ref`.
- Task-aware `ph context` adds non-sensitive `work` and `project` matches when the hub is configured; a hub error leaves local project context available and prints a warning.

### G6 — Give coding agents scoped shared-memory tools

- MCP `search_shared_memory` can search only `work` or `project` scope and requests sensitive records excluded.
- MCP `save_shared_memory` can write only `work` or `project` scope, always with `normal` sensitivity and a required source reference.
- MCP has no argument that can override the sensitive-write explicit-consent policy.
- Both tools use the separate memory-hub URL and API key; an unconfigured hub returns a clear MCP tool error.

### G7 — Automatically capture directly evidenced work memory

- When the hub URL/key are configured, completed Claude Code, Codex CLI, Gemini CLI, and OpenCode captures start background extraction by default; `memory-auto-capture=false` disables it.
- The client sends the bounded prompt/response to the configured inference provider. The hub receives only derived memory records, never the raw interaction through this path.
- The extractor may write at most two `work-preference` or `project-decision` records in `work`/`project` scope. Each requires an exact supporting quote in the user prompt; assistant-only proposals are rejected.
- Personal scope is never written automatically. Model-flagged sensitive items and credential/personal-topic matches are dropped by deterministic validation.
- Stable IDs and `prompt:<id>:<ordinal>` provenance make retries idempotent. Interaction metadata records extraction status and memory IDs. `ph memory undo <interaction-id>` reversibly forgets those records.
- `ph status` reports whether extraction is pending, complete, empty, or failed. Extraction failure does not prevent local prompt capture or transcript sync.

## Verification

Vitest coverage exercises create/search/forget/restore over a real HTTP socket, explicit-sensitive validation, idempotency and ID collision behavior, API authentication, client credential separation, non-sensitive context retrieval, MCP shared-memory scope/write policy, evidence-bound extraction filtering, automatic capture scheduling, and source-attributed background saves.

## Current boundaries

- One shared Bearer key; no per-client identity, revocation, or connector policy.
- No email, calendar, browser, or personal-assistant connector.
- No offline memory outbox, server-side extraction worker, conflict resolution, semantic memory index, or retention policy.
- The inference provider used by `ph close` remains client-configured; the hub stores only reviewed results.
- Raw capture and prompt-history sync remain independent features with their existing behavior.
