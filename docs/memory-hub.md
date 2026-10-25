# PH Memory Hub

PH can run as a self-hosted service for source-backed work and personal memories. The hub stores canonical memory records in its SQLite database. Configuring the memory hub does not itself send raw prompt history; that remains a separate remote-sync setting.

## Deploy

The generic container recipe lives in `deploy/`. On a Linux host with Docker Compose:

```sh
cp deploy/.env.example deploy/.env
openssl rand -hex 32
# Put the generated value in deploy/.env as PH_SERVER_API_KEY.
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

The service binds to loopback by default. For clients on other devices, expose it only through a private network or a TLS reverse proxy with firewall rules. Set `PH_BIND_ADDRESS` in the private deployment environment to the appropriate protected interface. Do not expose the HTTP listener directly to the public Internet. `/health` is unauthenticated and returns only `{ "status": "ok" }`; all data routes require a Bearer key.

The named Docker volume `ph-data` holds the SQLite database. Back up the volume while the service is stopped or use SQLite's online backup API. Keep the environment file and backups outside source control.

## Configure a client

```sh
ph config set memory-hub-url https://memory.example
ph config set memory-hub-api-key
```

The second command prompts without echoing the key. The URL and key are stored in `~/.ph_config.json` with file mode `0600`. `PH_MEMORY_HUB_URL` and `PH_MEMORY_HUB_API_KEY` can override them for one process or a managed environment.

Memory-hub settings are separate from `remote-url` and `remote-api-key`. Setting them does not enable prompt-history synchronization or upload raw prompts and responses. `ph remote push` remains a separate, explicit operation.

## Use it

```sh
ph memory save "Prefers short, direct technical explanations" --scope work --kind preference
ph memory search "technical explanations"
ph memory show <memory-id>
ph memory forget <memory-id>
ph memory restore <memory-id>
```

Sensitive memories require an explicit flag. For shell-history privacy, pipe the content instead of placing it in command arguments:

```sh
printf '%s' 'Sensitive fact to retain' | ph memory save --scope personal --sensitive
ph memory search "Sensitive fact" --include-sensitive
```

Search results and `ph context` exclude sensitive memories unless the user explicitly requests them. `ph context "task"` retrieves non-sensitive work and project memories from the hub when configured. The PH MCP server exposes `search_shared_memory` and `save_shared_memory` to coding agents; those tools can only read or write non-sensitive `work` and `project` memories. Their save tool is intended for durable decisions and preferences, with a prompt or session source reference. Sensitive and personal-scope writes remain on the explicit CLI path. `ph close` continues to show proposed project knowledge for review; only approved items are also copied to the hub, with originating prompt IDs recorded as source references.

### Automatic coding-agent memory

When both the memory hub URL and key are configured, PH automatically starts a background extraction after a completed capture from Claude Code, Codex CLI, Gemini CLI, or OpenCode. This does not depend on the agent choosing to call an MCP tool. The configured analysis provider receives the captured user prompt and assistant response (bounded to 4,000 characters each) to identify at most two durable work preferences or project decisions. The hub receives only the derived memory, its scope/type, and `prompt:<id>` provenance; raw prompt history is not sent to the hub by this path.

The extractor requires an exact supporting quote from the user prompt, rejects assistant-only proposals and sensitive candidates, and only permits `work` or `project` scope. PH never automatically writes `personal` memories. Since model classification cannot guarantee perfect sensitivity detection, keep the configured inference provider appropriate for the interaction data. Automatic memory is enabled when the hub is configured unless explicitly disabled:

```sh
ph config set memory-auto-capture false
ph config set memory-auto-capture true
ph status
ph memory undo <interaction-id>
ph memory retry <interaction-id>
```

`ph status` reports each recent interaction's extraction state. `ph memory undo <interaction-id>` reversibly forgets all automatically saved items for that interaction; it prints memory IDs that can be restored with `ph memory restore <memory-id>`. Use `ph memory retry <interaction-id>` after an inference or hub outage.

## API

All data routes use `Authorization: Bearer <key>`:

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/memories` | Create an idempotent, source-attributed memory |
| `POST` | `/api/memories/search` | Search active memories by text and optional scope |
| `GET` | `/api/memories/{uuid}` | Read a memory |
| `DELETE` | `/api/memories/{uuid}` | Mark a memory forgotten and record the prior state |
| `POST` | `/api/memories/{uuid}/restore` | Restore a forgotten memory |

Scopes are `work`, `personal`, and `project`. A sensitive write must include `sensitivity: "sensitive"` and `explicit_sensitive: true`; otherwise the server rejects it. Forgetting is reversible and the old status is recorded in `personal_memory_versions`.

## Current limits

- The server currently uses one shared Bearer key. It does not yet issue separate client identities or connector-specific permissions.
- Connectors for email, calendar, browser, and personal assistant clients are not included.
- Automatic extraction runs on the client after coding-agent captures; the hub stores derived records and does not run an inference worker.
- There is no offline memory outbox or conflict-resolution workflow yet. Prompt capture remains local if the hub is unavailable; memory writes require the hub to be reachable.
- The current search is SQLite text matching. Semantic personal-memory retrieval and retention rules are future work.
- PH does not automatically infer personal memories from captured conversations. This avoids silently turning full prompt history into durable personal memory.
