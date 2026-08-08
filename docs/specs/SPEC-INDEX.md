# SPEC INDEX — ph

Spec-driven baseline for **ph** (Prompt History & Analysis — transparent
observability layer for AI CLI tools). Reverse-engineered from code on
2026-08-08 with `path:line` evidence. Published as `@gi4nks/ph` (npm,
semantic-release + OIDC provenance).

Cluster map: Core (CLI/architecture) · Capture (wrapper/hooks/log) · DB (PhDB)
· Search (FTS/semantic) · AI (analysis/embeddings) · Memory (memories/summaries)
· Sync (server/remote) · MCP · TUI · Import · Analytics · Config.

## Registry

| ID | Feature | Cluster | Status | Tests |
|----|---------|---------|--------|-------|
| SPEC-001 | Architecture & CLI dispatch | Core | **Implemented (baseline)** | — |
| SPEC-002 | Database layer (PhDB) | DB | **Implemented (baseline)** | — |
| SPEC-003 | Capture modes (pty/inline/hooks/log) | Capture | **Implemented (baseline)** | — |
| SPEC-004 | Filter pipeline & metadata | Core | **Implemented (baseline)** | — |
| SPEC-005 | Search (FTS + filters + semantic) | Search | **Implemented (baseline)** | — |
| SPEC-006 | Analysis pipeline (LLM) | AI | **Implemented (baseline)** | — |
| SPEC-007 | Memory & project summaries | Memory | **Implemented (baseline)** | — |
| SPEC-008 | Embeddings (sqlite-vec) | AI | **Implemented (baseline)** | — |
| SPEC-009 | Retention & archive | DB | **Implemented (baseline)** | — |
| SPEC-010 | Remote sync (server + push/pull) | Sync | **Implemented (baseline)** | — |
| SPEC-011 | MCP server | MCP | **Implemented (baseline)** | — |
| SPEC-012 | TUI browser | TUI | **Implemented (baseline)** | — |
| SPEC-013 | Importers (claude/gemini/opencode) | Import | **Implemented (baseline)** | — |
| SPEC-014 | Analytics commands (sessions/stats/cluster/timeline) | Analytics | **Implemented (baseline)** | — |
| SPEC-015 | Config & env overrides | Config | **Implemented (baseline)** | — |

## Cross-cutting findings (SPEC-ISSUES.md)

See SPEC-ISSUES.md for code-vs-doc discrepancies and open questions collected
while reverse-engineering the baseline.
