# PH Architecture

PH is a local-first plain-text CLI, SQLite store, and stdio MCP server for capturing AI coding interactions and retrieving project context.

## Component Overview

```mermaid
flowchart LR
    subgraph Tools["Coding Tools & Clients"]
        Hooks["Native Hooks\n(Claude, Codex, Gemini, OpenCode, AGY)"]
        CLI["PH CLI (src/cli.ts)"]
        MCP["MCP stdio (src/mcp/)"]
    end

    subgraph Core["PH Core (Node.js 22+ / TypeScript ESM)"]
        Capture["Capture & Importers\n(src/capture/, src/importer/)"]
        Context["Context & Memory\n(src/context/, src/memory/)"]
        Analyzer["Optional AI & Embeddings\n(src/ai/, src/embedding/)"]
        Sync["Sync & HTTP Server\n(src/sync/, src/server/)"]
    end

    subgraph Storage["Local & Optional Remote Storage"]
        DB["SQLite (~/.prompt_history.db)\nSchema v6 + FTS5 + sqlite-vec"]
        Hub["Optional Memory Hub\n(PH_MEMORY_HUB_API_KEY)"]
        Remote["Optional Raw History Remote\n(PH_REMOTE_URL)"]
    end

    Hooks --> Capture
    CLI --> Capture
    CLI --> Context
    MCP --> Context
    Capture --> DB
    Context --> DB
    Context --> Hub
    Analyzer --> DB
    Sync --> DB
    Sync --> Remote
```

## Capture and Context Flow

```mermaid
sequenceDiagram
    participant Tool as AI Coding CLI
    participant Hook as ph hook <tool>
    participant DB as SQLite (Schema v6)
    participant BG as Background Worker

    Tool->>Hook: Completed turn payload
    Hook->>DB: Insert with contextual capture_hash (dedup)
    Hook-->>Tool: Exit immediately (non-blocking)
    Hook-)BG: Spawn detached follow-up (if configured)
    BG->>DB: Optional analysis / embedding / memory extraction
```

## Storage & Security Boundaries

- **Local-first by default:** interactions stay in `~/.prompt_history.db` (SQLite + FTS5 + optional `sqlite-vec` partitioned by `project`).
- **Sensitive records:** personal and sensitive memories are excluded from default `ph context`, `ph search`, and MCP responses.
- **Separated remote channels:** `PH_MEMORY_HUB_API_KEY` syncs only derived work/project memories (with local `pending` queue fallback); `PH_REMOTE_URL` is a separate explicit opt-in for raw history push/pull.

## Further Reading

- [User Manual](ph-manual.md)
- [Capture Hook Guide](hooks.md)
- [Memory Hub Operations](memory-hub.md)
- [Feature Specifications](specs/SPEC-INDEX.md)
