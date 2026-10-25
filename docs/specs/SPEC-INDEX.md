# SPEC INDEX — ph

Spec-driven baseline for **ph** (Prompt History & Analysis — transparent
observability layer for AI CLI tools). Reverse-engineered from code on
2026-08-08 with `path:line` evidence. Published as `@gi4nks/ph` (npm,
semantic-release + OIDC provenance).

Cluster map: Core (CLI/architecture) · Capture (wrapper/hooks/log) · DB (PhDB)
· Search (FTS/semantic) · AI (analysis/embeddings) · Memory (memories/summaries)
· Sync (server/remote) · MCP · Import · Analytics · Config. The history TUI was
retired on 2026-10-22; SPEC-012 is retained as a decision record.

## Registry

| ID | Feature | Cluster | Status | Tests |
|----|---------|---------|--------|-------|
| SPEC-001 | Architecture & CLI dispatch | Core | **Implemented (plain-text daily workflow)** | `src/commands/__tests__/operational-memory.test.ts` |
| SPEC-002 | Database layer (PhDB) | DB | **Implemented; stable DB identity and one-time metadata migration (SPEC-019)** | `src/db/__tests__/phdb.test.ts` |
| SPEC-003 | Capture modes (pty/inline/hooks/log) | Capture | **Implemented; shared live lifecycle (SPEC-019)** | `src/runner/inline.test.ts`, `src/capture/lifecycle.ts` |
| SPEC-004 | Filter pipeline & metadata | Core | **Implemented (baseline)** | — |
| SPEC-005 | Search (FTS + filters + semantic) | Search | **Implemented; cross-index RRF and scoped CLI vector loading (SPEC-019)** | `src/db/__tests__/phdb.test.ts`, `src/commands/__tests__/search.test.ts` |
| SPEC-006 | Analysis pipeline (LLM) | AI | **Implemented (baseline)** | — |
| SPEC-007 | Memory & project summaries | Memory | **Implemented (baseline)** | — |
| SPEC-008 | Embeddings (sqlite-vec) | AI | **Implemented (baseline)** | — |
| SPEC-009 | Retention & archive | DB | **Implemented (baseline)** | — |
| SPEC-010 | Remote sync (server + push/pull) | Sync | **Implemented; database-scoped cursors, active-capture barrier, byte-bounded pages (SPEC-019)** | `src/server/__tests__/server.test.ts`, `src/commands/__tests__/remote.test.ts`, `src/sync/__tests__/client.test.ts` |
| SPEC-011 | MCP server | MCP | **Implemented (baseline)** | — |
| SPEC-012 | Interactive history browser | Retired UI | **Retired 2026-10-22** | — |
| SPEC-013 | Importers (claude/gemini/opencode/codex) | Import | **Implemented** | import fixtures |
| SPEC-014 | Analytics commands (sessions/stats/cluster/timeline) | Analytics | **Implemented (baseline)** | — |
| SPEC-015 | Config & env overrides | Config | **Implemented (baseline)** | — |
| SPEC-016 | Operational memory workflow (context/close/MCP provenance) | Memory, CLI, MCP | **Implemented** | `src/commands/__tests__/operational-memory.test.ts`, `src/mcp/__tests__/server.test.ts` |
| SPEC-017 | Internal architecture consolidation (CLI surface gate, MCP modules, DB repositories) | Core, DB, MCP | **Implemented** | `src/knowledge/`, `src/mcp/tools/`, `src/db/{memory,archive}-repository.ts` |
| SPEC-018 | Interaction inspection and recall integrity | Core, Capture, Search, Memory, MCP | **Implemented** | `src/commands/__tests__/`, `src/db/__tests__/phdb.test.ts`, `src/context/__tests__/context.test.ts`, `src/mcp/__tests__/server.test.ts` |
| SPEC-019 | Network, capture, and retrieval integrity | Capture, Sync, Search, CLI | **Implemented; follow-up edge cases closed** | `src/server/__tests__/server.test.ts`, `src/capture/__tests__/lifecycle.test.ts`, `src/commands/__tests__/remote.test.ts`, `src/sync/__tests__/client.test.ts`, `src/commands/__tests__/search.test.ts`, `src/db/__tests__/phdb.test.ts` |
| SPEC-020 | Governed personal memory hub | Memory, Server, CLI, MCP | **Implemented; automatic evidence-bound coding-agent capture** | `src/server/__tests__/server.test.ts`, `src/commands/__tests__/memory-hub.test.ts`, `src/commands/__tests__/background-memory.test.ts`, `src/analyzer/__tests__/automatic-memory.test.ts`, `src/mcp/__tests__/server.test.ts` |

## Cross-cutting findings (SPEC-ISSUES.md)

See SPEC-ISSUES.md for code-vs-doc discrepancies and open questions collected
while reverse-engineering the baseline.
