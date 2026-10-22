# SPEC-017 — Internal architecture consolidation

- **ID**: SPEC-017
- **Cluster**: Core, DB, MCP
- **Status**: Implemented
- **Date**: 2026-10-22

## Purpose

Reduce internal coupling and constrain product-surface growth without changing
the public behavior of existing PH commands, MCP tools, or the SQLite schema.

**Spec impact: none.** This is an internal-only change. Existing CLI syntax,
MCP tool names and payloads, database schema, persisted data, and retrieval
results remain compatible.

## Decisions

1. Do not add, remove, rename, or deprecate user-facing commands in this work.
   Clarify the existing jobs of `context`, `prepare`, agent-facing MCP, and
   `chat`; hold new feature proposals until the operational workflow is used on
   three real tasks across different projects.
2. Keep `src/mcp/server.ts` as the protocol composition root. Move tool
   declarations, domain handlers, and response formatting into cohesive
   modules. It remains responsible for MCP SDK registration and error/content
   envelope translation.
3. Keep `PhDB` as the public facade and keep its constructor, method names, and
   return values stable. Keep prompt CRUD, FTS, schema, and migrations in the
   prompt core. Move memory/summary operations and archive operations behind
   internal repositories sharing the same SQLite connection. Semantic vectors
   remain in the existing `SemanticIndex`. Preserve the single connection and
   transaction boundary.
4. Reuse shared project-context and memory-promotion operations from CLI and
   MCP. Adapters must not own business validation or multi-write consistency.

## Acceptance

- Existing commands and all registered MCP tools retain their current names,
  schemas, behavior, and text response contracts.
- Existing databases open without migration or data rewrite.
- `PhDB` remains source-compatible for current callers.
- MCP server composition contains no per-tool business logic or response
  formatting.
- Memory/summary and archive SQL operations are owned by cohesive internal
  persistence modules; prompt CRUD and FTS remain together in the prompt core.
  Transaction behavior stays on the shared connection.
- New user-facing capabilities are not introduced in this change.
- Existing test suite, lint, TypeScript check, and build pass.

## Verification

- `npm test`: 17 files, 94 tests passed.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed.

## Non-goals

- Removing or renaming existing commands or MCP tools.
- Reworking retrieval ranking, metadata storage, or the SQLite schema.
- Splitting files solely to reduce line counts.
- Adding agent feedback, automatic memory promotion, or project-state
  fingerprinting.
