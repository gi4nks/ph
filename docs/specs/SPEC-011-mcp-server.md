# SPEC-011: MCP Server

- **ID**: SPEC-011
- **Cluster**: MCP
- **Status**: Implemented (baseline)
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
Agent-facing interface to ph's knowledge: an MCP stdio server
(`ph mcp`) exposing prompt history search, project memories/summaries, timelines
and decision recording. Auto-discovered by MCP clients (Claude Code, OpenCode,
etc.) — the primary consumer per the evolution plan.

## 2. Scope
- **In scope**: 11 registered tools, list/call handlers, stdio transport.
- **Out of scope**: the memory/analysis internals (SPEC-006/007), HTTP server
  (SPEC-010).
- **Entry points**: `ph mcp` (stdio); tools auto-listed via ListToolsRequest.

## 3. Data Model
- MCP `tools` registration (src/mcp/server.ts:30-187):
  - `list_prompts` (:34)
  - `save_decision` (:47) — writes to project_summaries
  - `get_project_diff` (:69)
  - `search_project_memory` (:82) — keyword + semantic with summary fallback
  - `get_project_context` (:95)
  - `get_project_summary` (:107)
  - `search_prompts` (:118) — FTS
  - `get_prompt` (:135) — by id
  - `search_prompts_semantic` (:146)
  - `get_project_timeline` (:159)
  - `check_project_knowledge` (:173) — "found" vs "new work"
- Transport: `McpServer` stdio (src/mcp/server.ts:20).

## 4. Flows

### 4.1 Tool invocation
1. Client lists tools → `ListToolsRequestSchema` handler returns the 11 tools
   (src/mcp/server.ts:30-187).
2. Client calls a tool → `CallToolRequestSchema` handler (src/mcp/server.ts:189)
   dispatches by name, opens a PhDB per call (or a shared one), returns
   `{ content: [{ type: 'text', text }] }`.
3. `check_project_knowledge` (173) is the pre-implementation gate: agents call
   it before coding a feature; it searches memories + semantic prompt history and
   recommends "found" (with context) or "new work".

## 5. Invariants & Business rules
- All tools are read-only EXCEPT `save_decision` (writes summaries).
- `search_project_memory` falls back to `project_summaries` when semantic search
  returns nothing (AGENTS.md, Phase 3).
- Every tool result is a text content block (JSON strings for structured data).
- The server is stdio-only (no network transport).

## 6. UI / UX surface
None (protocol). Consumed by agents: `ph mcp` must be registered in the client's
MCP config.

## 7. Acceptance criteria (Given/When/Then)
- **G1**: Given a client ListTools request, When the server responds, Then the
  tool list contains `search_prompts`, `get_prompt`, `search_project_memory`,
  `get_project_context`, `get_project_summary`, `check_project_knowledge` and
  `save_decision` (src/mcp/server.ts:30-187).
- **G2**: Given `get_prompt` with an existing id, When called, Then the prompt
  text is returned (src/mcp/server.ts:135-145).
- **G3**: Given `search_prompts` with a query, When called, Then FTS results are
  returned as text content (src/mcp/server.ts:118-134).
- **G4**: Given `save_decision` with project/decision, When called, Then the
  decision is written to project_summaries (src/mcp/server.ts:47-68,
  SPEC-007).
- **G5**: Given a project with no knowledge, When `check_project_knowledge` is
  called, Then the response recommends "new work" (src/mcp/server.ts:173-187).

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| Server + transport | src/mcp/server.ts:1-30 |
| Tool registry + handlers | src/mcp/server.ts:30-260 |
| Memory/summary backends | src/db/index.ts:535-699 |

## 9. Open questions / discrepancies
- A new PhDB is opened per call — connection churn on high-frequency agent use
  (verify in the handler; a shared instance + close-on-exit would be cheaper).
- No tool input validation with zod (raw JSON.parse of arguments) — malformed
  args from a client surface as handler errors.
- `get_project_diff` reads git state — behavior beyond the name needs
  verification against git-context.ts.

## 10. Related
- SPEC-005/007/008 (backends), SPEC-006 (analysis feeding knowledge),
  evolution plan (MCP as primary interface). No tests (SPEC-ISSUES-007).
