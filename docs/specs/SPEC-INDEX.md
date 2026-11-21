# PH Behavior Specifications

This index separates current implementation references from historical specifications. For user workflows, the current authorities are [README](../../README.md) and the [user manual](../ph-manual.md). Historical specs preserve decisions and earlier behavior; they are not a current command reference.

## Current implementation specifications

All active specifications below live in `docs/specs/` and reflect current implementation contracts (alongside the [SPEC-ISSUES.md](SPEC-ISSUES.md) ledger).

| ID | Area | Current status | Primary evidence |
|---|---|---|---|
| [SPEC-019](SPEC-019-network-capture-and-ranking-integrity.md) | Network, capture, and retrieval integrity | **Current** — Implemented; later sync/database identity and embedding provenance fixes are recorded in [SPEC-ISSUES.md](SPEC-ISSUES.md) and must be checked against source. | src/capture/, src/sync/, src/server/, src/db/semantic-index.ts |
| [SPEC-020](SPEC-020-personal-memory-hub.md) | Shared memory hub and automatic capture | **Current** — Implemented with the unified memory model; client setup and operational behavior are documented in the manual and Memory Hub guide. | src/memory/, src/server/, src/analyzer/automatic-memory.ts, src/capture/lifecycle.ts |
| [SPEC-021](SPEC-021-lossless-memory-migration.md) | Lossless unified memory migration | **Current** — Implemented in schema v4; legacy memory data and provenance are retained during migration. | src/db/index.ts, src/db/memory-repository.ts, src/db/__tests__/phdb.test.ts |

## Historical and superseded specifications

These documents are archived under `docs/specs/archive/` and remain useful for the original requirements and the evolution of PH. Some describe retired commands, the former TUI, earlier schemas, or modules removed by later refactoring. Do not use them to infer today's command surface.

| ID | Original subject | Current note |
|---|---|---|
| [SPEC-001](archive/SPEC-001-architecture-cli.md) | Architecture and CLI dispatch | The old command/workflow description is superseded by the current CLI help and manual. |
| [SPEC-002](archive/SPEC-002-database-layer.md) | Database layer | Baseline schema notes; current version is schema v4 and migration behavior is in [SPEC-021](SPEC-021-lossless-memory-migration.md). |
| [SPEC-003](archive/SPEC-003-capture-modes.md) | Capture modes | Baseline wrapper/hooks/log model; supported integrations are in [docs/hooks.md](../hooks.md). |
| [SPEC-004](archive/SPEC-004-filter-metadata.md) | Filter pipeline and metadata | Historical baseline behavior. |
| [SPEC-005](archive/SPEC-005-search.md) | Search | Historical baseline behavior; use the current manual for supported filters and archive semantics. |
| [SPEC-006](archive/SPEC-006-analysis-pipeline.md) | LLM analysis | Historical baseline provider and analysis behavior. |
| [SPEC-007](archive/SPEC-007-memory-summaries.md) | Memory and project summaries | Earlier memory model; unified local/shared memory is described in [SPEC-020](SPEC-020-personal-memory-hub.md)/[SPEC-021](SPEC-021-lossless-memory-migration.md) and the user manual. |
| [SPEC-008](archive/SPEC-008-embeddings.md) | Embeddings | Earlier vector implementation details; verify present behavior in source. |
| [SPEC-009](archive/SPEC-009-retention-archive.md) | Retention and archive | Baseline behavior; current cleanup effects are described in the user manual. |
| [SPEC-010](archive/SPEC-010-remote-sync.md) | Remote sync | Baseline protocol; current database identity/checkpoint behavior is in source and [SPEC-ISSUES.md](SPEC-ISSUES.md). |
| [SPEC-011](archive/SPEC-011-mcp-server.md) | MCP server | Earlier tool list is retired; current MCP exposes five tools, listed in the manual and feature catalog. |
| [SPEC-012](archive/SPEC-012-tui-browser.md) | Interactive history browser | Retired on 2026-10-22. |
| [SPEC-013](archive/SPEC-013-importers.md) | Importers | Original list predates the AGY importer; current sources are Claude, Codex, Gemini, OpenCode, and AGY. |
| [SPEC-014](archive/SPEC-014-analytics-commands.md) | Analytics commands | The original ph cluster command is retired; current views include sessions, stats, and timeline. |
| [SPEC-015](archive/SPEC-015-config-env.md) | Config and environment | Historical baseline; consult current ph config help and manual. |
| [SPEC-016](archive/SPEC-016-operational-memory.md) | Operational memory workflow | ph prepare, ph close, and save_decision were retired; the current command is ph context, with ph memory and the current MCP tools. |
| [SPEC-017](archive/SPEC-017-architecture-consolidation.md) | Internal architecture consolidation | Historical refactoring decision; its former module paths may no longer exist. |
| [SPEC-018](archive/SPEC-018-interaction-inspection-and-recall-integrity.md) | Interaction inspection and recall integrity | Historical specification; use current source and user documentation for present details. |

## Archived roadmaps

Historical planning roadmaps have been archived in `docs/archive/`:
- [ROADMAP.md](../archive/ROADMAP.md)
- [ROADMAP_RAG.md](../archive/ROADMAP_RAG.md)

## Cross-cutting findings

See [SPEC-ISSUES.md](SPEC-ISSUES.md) (current, in `docs/specs/`) for the dated finding ledger. Resolved entries are historical evidence, not open work. The current schema version, command names, and source paths in that ledger are updated where they affect present operation.
