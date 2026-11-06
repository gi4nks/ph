# PH Behavior Specifications

This index separates current implementation references from historical specifications. For user workflows, the current authorities are [README](../../README.md), the [user manual](../ph-manual.md), and the [feature and operations catalog](../ph-feature-catalog.html). Historical specs preserve decisions and earlier behavior; they are not a current command reference.

## Current implementation specifications

| ID | Area | Current status | Primary evidence |
|---|---|---|---|
| SPEC-019 | Network, capture, and retrieval integrity | Implemented; later sync/database identity and embedding provenance fixes are recorded in [SPEC-ISSUES](SPEC-ISSUES.md) and must be checked against source. | src/capture/, src/sync/, src/server/, src/db/semantic-index.ts |
| SPEC-020 | Shared memory hub and automatic capture | Implemented with the unified memory model; client setup and operational behavior are documented in the manual and Memory Hub guide. | src/memory/, src/server/, src/analyzer/automatic-memory.ts, src/capture/lifecycle.ts |
| SPEC-021 | Lossless unified memory migration | Implemented in schema v4; legacy memory data and provenance are retained during migration. | src/db/index.ts, src/db/memory-repository.ts, src/db/__tests__/phdb.test.ts |

## Historical and superseded specifications

These documents remain useful for the original requirements and the evolution of PH. Some describe retired commands, the former TUI, earlier schemas, or modules removed by later refactoring. Do not use them to infer today's command surface.

| ID | Original subject | Current note |
|---|---|---|
| SPEC-001 | Architecture and CLI dispatch | The old command/workflow description is superseded by the current CLI help and manual. |
| SPEC-002 | Database layer | Baseline schema notes; current version is schema v4 and migration behavior is in SPEC-021. |
| SPEC-003 | Capture modes | Baseline wrapper/hooks/log model; supported integrations are in docs/hooks.md. |
| SPEC-004 | Filter pipeline and metadata | Historical baseline behavior. |
| SPEC-005 | Search | Historical baseline behavior; use the current manual for supported filters and archive semantics. |
| SPEC-006 | LLM analysis | Historical baseline provider and analysis behavior. |
| SPEC-007 | Memory and project summaries | Earlier memory model; unified local/shared memory is described in SPEC-020/021 and the user manual. |
| SPEC-008 | Embeddings | Earlier vector implementation details; verify present behavior in source. |
| SPEC-009 | Retention and archive | Baseline behavior; current cleanup effects are described in the user manual. |
| SPEC-010 | Remote sync | Baseline protocol; current database identity/checkpoint behavior is in source and SPEC-ISSUES. |
| SPEC-011 | MCP server | Earlier tool list is retired; current MCP exposes five tools, listed in the manual and feature catalog. |
| SPEC-012 | Interactive history browser | Retired on 2026-10-22. |
| SPEC-013 | Importers | Original list predates the AGY importer; current sources are Claude, Codex, Gemini, OpenCode, and AGY. |
| SPEC-014 | Analytics commands | The original ph cluster command is retired; current views include sessions, stats, and timeline. |
| SPEC-015 | Config and environment | Historical baseline; consult current ph config help and manual. |
| SPEC-016 | Operational memory workflow | ph prepare, ph close, and save_decision were retired; the current command is ph context, with ph memory and the current MCP tools. |
| SPEC-017 | Internal architecture consolidation | Historical refactoring decision; its former module paths may no longer exist. |
| SPEC-018 | Interaction inspection and recall integrity | Historical specification; use current source and user documentation for present details. |

## Cross-cutting findings

See [SPEC-ISSUES.md](SPEC-ISSUES.md) for the dated finding ledger. Resolved entries are historical evidence, not open work. The current schema version, command names, and source paths in that ledger are updated where they affect present operation.
