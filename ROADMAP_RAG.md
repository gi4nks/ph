# Evolution Plan: `ph` into a Project RAG Memory System

This document outlines the strategic roadmap to transform `ph` (Prompt History) from a passive observability tool into an active, project-aware RAG (Retrieval-Augmented Generation) system.

## 🎯 Vision
`ph` will not only track what you asked, but will "understand" the project context, summarize key decisions, and expose this memory to AI agents via MCP (Model Context Protocol).

---

## ✅ Phase 0: Code Restructuring
**Goal:** Refactor monolithic `cli.ts` into command modules + add DB foundations for project memory.

- [x] **Task 0.1: Extract commands** — moved all inline command handlers from `cli.ts` (~1500 lines) into `src/commands/*.ts`, dispatched via switch (~80 lines)
- [x] **Task 0.2: Shared helpers** — `parseFlags()`, `parseDate()` → `src/commands/_utils.ts`
- [x] **Task 0.3: `memories` table** — added schema + 8 CRUD methods to `PhDB`
- [x] **Task 0.4: `$schema_version`** — added to `PromptMetadata` for forward-compatible schema evolution

---

## ✅ Phase 1: Database & Semantic Engine Upgrade
**Goal:** Move from manual JS-based similarity to a native, high-performance vector search.

- [x] **Task 1.1: Integrate `sqlite-vec`** — dependency added, loaded in `PhDB` constructor
- [x] **Task 1.2: New Schema for Memory** — `vec0` table + `memories` table with `summary`, `key_insights`, `technical_decisions`
- [x] **Task 1.3: Migration Tool** — automatic migration from old `embeddings` BLOB table to `vec_embeddings` on DB open

---

## 🧠 Phase 2: Enhanced AI Analysis (The "Cervello")
**Goal:** Extract high-value knowledge from raw prompt/response pairs.

- [x] **Task 2.1: Advanced Analysis Prompt** — `ANALYSIS_PROMPT` now requests `summary`, `key_insights`, `technical_decisions`
- [x] **Task 2.2: Background Memory Worker** — `analyzeAll` + `cmdBackgroundAnalyze` call `upsertProjectMemory()` after each analysis
- [x] **Task 2.3: `ph context` with memories** — outputs project knowledge from `memories` table + recent interactions in markdown format
- [ ] **Task 2.4: Context Hash / Git State** — track project state changes to avoid duplicate memories

---

## 🔌 Phase 3: MCP Server Integration
**Goal:** Make `ph` memory available to Claude Desktop, Cursor, and Gemini natively.

- [x] **Task 3.1: MCP Server Implementation** — `src/mcp/server.ts` using `@modelcontextprotocol/sdk` (156 lines)
- [x] **Task 3.2: Tools Exposure** — expose `search_project_memory`, `get_project_context` (with memories), `get_project_summary` via MCP
- [x] **Task 3.3: CLI Command `ph mcp`** — launches stdio MCP server

---

## 💻 Phase 4: CLI & TUI UX Enhancements
**Goal:** Make context easy to use from the terminal.

- [x] **Task 4.1: Command `ph context`** — outputs markdown context with `--memories-only`, `--prompts-only`, `--verbose` flags
- [x] **Task 4.2: TUI "Chat" Mode** — `C` (Shift+C) keybinding in `BrowseApp.tsx` launches tool with project context prepended
- [x] **Task 4.3: Command `ph chat`** — `ph chat <tool> <prompt...>` wrapper that injects RAG context automatically

---

## 🧪 Success Metrics
- **Latency:** Semantic search should take < 50ms for 10k entries.
- **Accuracy:** AI-generated summaries must accurately reflect technical decisions (verified by user review).
- **Utility:** Ability to resolve a "How did I do X in project Y?" query using `ph context` without manual searching.
