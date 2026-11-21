# PH Memory Hub

The optional PH Memory Hub is a shared API for durable memories. It stores the canonical memory records in the hub's SQLite database so configured PH clients can search, add, forget, and restore memories. It is not a prompt-history server. Configuring the hub does not by itself upload raw prompt/response history.

## Deployment with Docker Compose

Requirements: a Linux host with Docker Engine and the Docker Compose plugin. From a PH checkout:

```sh
cp deploy/.env.example deploy/.env
cp deploy/memory.env.example deploy/memory.env
```

Generate two different keys and place them in the corresponding files:

```sh
openssl rand -hex 32
openssl rand -hex 32
```

- Put `PH_SERVER_API_KEY` in `deploy/.env` if you also want raw prompt-sync endpoints. Leave it unset for a memory-hub-only deployment.
- Put `PH_MEMORY_HUB_API_KEY` in `deploy/memory.env`. It protects shared-memory endpoints.
- Both `deploy/compose.yaml` and `ph server` can run memory-only with just `PH_MEMORY_HUB_API_KEY`, or expose both route groups when both keys are provided.
- Keep the values different when both are configured. The service rejects identical keys.
- Keep both files and all database backups out of source control. Restrict file access (for example, `chmod 600 deploy/.env deploy/memory.env`).
- The Docker image builds without optional native PTY bindings (`--omit=optional`) and runs as the non-root `node` user.

Start and verify the service:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
curl --fail http://127.0.0.1:3001/health
```

The container stores its database at `/data/ph.db` in the named `ph-data` volume. The default published listener is loopback on port 3001. For remote clients, expose the service only through a private network or a properly secured TLS reverse proxy and firewall. Do not publish the plain HTTP listener directly to the public internet. Preserve the named volume and take a SQLite-consistent backup before schema/image upgrades. Do not use `docker compose down --volumes` as a routine update or rollback step.

## Configure a client

Configure the base URL reachable from the client and the memory key. PH prompts without echoing the key if `memory-hub-api-key` is set with no inline value:

```sh
ph config set memory-hub-url https://<private-host>
ph config set memory-hub-api-key
ph status
```

For managed environments, `PH_MEMORY_HUB_URL` and `PH_MEMORY_HUB_API_KEY` override the corresponding client settings. PH stores interactive configuration in `~/.ph_config.json` with mode `0600`.

When both URL and key are configured, `ph memory` uses the shared hub rather than the local memory table. If a hub save hits a transient network or 5xx error, PH queues it locally with `pending` sync status; inspect pending entries with `ph status` and push them with `ph memory sync`. `ph context` and MCP can include shared project/work memories as well as their local history, bounded by the single unified `--budget` / `maxChars` ceiling. Personal and sensitive memories remain excluded from ordinary retrieval. Shared-memory IDs are UUIDs.

## Automatic memory extraction

When both hub credentials are configured and `memory-auto-capture` is not disabled, PH schedules extraction after completed captures from supported coding tools. A successful extraction additionally needs a usable PH inference provider; if the provider is not configured or reachable, the background attempt fails and is reported by `ph status`. The setting defaults to enabled when hub credentials are configured. To disable it:

```sh
ph config set memory-auto-capture false
```

The selected inference provider receives bounded copies of the captured user prompt and assistant response. PH accepts at most two work/project candidates and requires an exact supporting quote from the user prompt. Personal-scope candidates are not accepted, and deterministic checks reject common sensitive or credential patterns. Model classification can still make mistakes: choose the inference service according to the data it will receive. The hub receives derived memory records and source references through this path, not the raw interaction.

Use `ph status` to inspect per-interaction extraction state. `ph memory retry <interaction-id>` retries extraction; `ph memory undo <interaction-id>` reversibly forgets memories created from one interaction.

## Separate raw-history sync

PH can also synchronize full prompt/response history with the HTTP server. This is independent from the memory API and uses `PH_SERVER_API_KEY` plus a separate client remote URL/key. If `PH_REMOTE_URL` or `remote-url` is configured, new completed captures are pushed automatically. `ph remote push` and `ph remote pull` perform resumable bulk synchronization. Do not configure raw-history sync unless you intend to transfer prompt and response text to that server.

The HTTP server binds to loopback by default. `/health` is public on `GET` and reports status only; all other requests and data routes require their respective bearer key. Keep the server key and memory key separate when both API groups are enabled. Both `ph server` and `deploy/compose.yaml` can run memory-only with just the memory key when raw-history routes are not needed.

## API routes

Memory routes require `Authorization: Bearer <PH_MEMORY_HUB_API_KEY>`:

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/memories` | Create an idempotent memory record with scope, kind, provenance, and sensitivity metadata. |
| `POST` | `/api/memories/search` | Search active memories with optional query, scope, project, and explicit privacy flags. |
| `GET` | `/api/memories/{uuid}` | Read one shared record. |
| `DELETE` | `/api/memories/{uuid}` | Reversibly forget a record and retain its prior state. |
| `POST` | `/api/memories/{uuid}/restore` | Restore a forgotten record. |

Sensitive API writes require both `sensitivity: "sensitive"` and `explicit_sensitive: true`. Search excludes sensitive records unless explicitly requested. If a client cannot reach the hub because of a transient network or 5xx error during `ph memory add`, PH saves the record locally with `pending` sync status; `ph status` reports pending entries and `ph memory sync` flushes them once the hub is reachable (explicit 4xx auth, policy, or consent errors still fail immediately). The hub still uses one shared bearer key without per-client identities, key revocation, connector-specific permissions, or multi-writer conflict resolution, and excludes email, calendar, and browser connectors.

Other data routes use `Authorization: Bearer <PH_SERVER_API_KEY>` (the client config key is `remote-api-key`). These routes are unavailable unless this key is configured. The direct service can start with only the memory key when raw-history routes are not needed:

| Method | Route | Request / purpose |
|---|---|---|
| `GET` | `/health` | Public status-only health response. |
| `POST` | `/api/prompts/search` | Search remote prompt history; accepts query, tool, project, role, tag, since, until, and limit. |
| `POST` | `/api/prompts/by-id` | Read one full prompt interaction by numeric ID. |
| `POST` | `/api/prompts/semantic` | Semantic prompt search using the server's configured Ollama embedding service. |
| `POST` | `/api/sync/push` | Push a page of up to 500 raw interaction records; duplicate records are skipped idempotently. |
| `POST` | `/api/sync/pull` | Pull raw interactions after a row-ID cursor; accepts a limit from 1 to 500 and returns the next cursor. |
| `GET` | `/api/stats` | Return aggregate interaction and memory counts and counts by tool. |

The memory API and raw-history routes use separate bearer keys. PH clients do not enable raw-history transfer when only the memory-hub URL/key are configured.
