# PH

PH keeps a searchable record of work with AI coding tools. It captures completed exchanges, stores prompt and response history locally, and helps you retrieve earlier work and durable project knowledge. PH is a plain-text CLI: it does not open a TUI and does not inject context into an agent automatically.

```sh
npm install -g @gi4nks/ph
ph setup
```

Restart the coding tools whose capture hooks PH installed. Then use them as usual. PH's normal command stays short and non-interactive:

```sh
ph search "sqlite migration"       # search this project
ph search --all "provider setup"   # search across projects
ph show 42                          # inspect the full prompt and response
ph context "add memory search"     # retrieve project context
ph memory search "migration"       # search durable memories
ph status                           # check capture and background work
```

`ph` by itself prints a short guide. Use `ph help --all` for the complete command and option list.

## What PH stores

- **Interaction history:** prompts and captured responses from Claude Code, Codex CLI, Gemini CLI, OpenCode, and Google Antigravity (AGY). History is stored in a local SQLite database by default.
- **Project context:** relevant local memories and prior interactions, retrieved with `ph context`. Optional embeddings improve retrieval; text search remains available without an inference service.
- **Durable memories:** project, work, or personal notes. They stay local unless a shared memory hub is configured. Personal and sensitive records are excluded from ordinary context and search by default.
- **Optional extraction:** with a hub and inference provider configured, PH can extract a small number of source-backed work decisions or preferences after supported captures. Bounded prompt and response text is sent to the configured inference provider; the hub receives derived records.

Save a decision with links to the interactions that support it:

```sh
ph memory add --project ph --prompts 42 "Keep prompt persistence behind the repository boundary"
```

PH checks cited IDs against the local history before saving. When a shared hub is configured, new memories and memory searches use that hub; `ph context` and MCP retrieve eligible memories from both local storage and the hub. Interaction history remains in the local database unless raw-history sync is configured.

PH does not upload raw prompt history merely because a memory hub is configured. Raw history sync is a separate feature. If `PH_REMOTE_URL` is configured, new completed captures are pushed to that remote; `ph remote push` and `ph remote pull` also support bulk sync. Review the data-flow details in the [user manual](docs/ph-manual.md) before enabling remote sync.

## Documentation

- [PH user manual](docs/ph-manual.md): install, capture, search, context, memories, inference, MCP, sync, maintenance, and troubleshooting.
- [Feature and operations catalog](docs/ph-feature-catalog.html): a visual, source-grounded inventory of the current command surface, integrations, data flows, and operational boundaries.
- [Capture hook guide](docs/hooks.md): supported integrations and setup behavior.
- [Memory hub operations](docs/memory-hub.md): generic self-hosting, API, security, and client configuration.
- [Feature specifications](docs/specs/SPEC-INDEX.md): implementation-backed behavior and historical decisions.

Run `ph help --all` for the complete command reference. PH requires Node.js 22 or newer.

## Development

```sh
npm ci
npm run dev -- help --all
npm test
npm run lint
npx tsc --noEmit
npm run build
```

## License

MIT
