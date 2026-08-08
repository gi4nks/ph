# SPEC-014: Analytics Commands (Sessions / Stats / Cluster / Timeline / Context)

- **ID**: SPEC-014
- **Cluster**: Analytics
- **Status**: Implemented (baseline)
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
Higher-level views over the history: work-session grouping (time gaps +
semantic cohesion), statistics, K-means clustering of prompts by embedding,
per-project timelines, and RAG context output.

## 2. Scope
- **In scope**: `ph sessions`, `ph stats`, `ph cluster`, `ph timeline`,
  `ph context`, `ph chat` (context injection).
- **Out of scope**: search (SPEC-005), embeddings (SPEC-008), memories
  (SPEC-007).
- **Entry points**: the five commands above.

## 3. Data Model
- `WorkSession` (src/sessions/index.ts:4): id, project, start/end, prompts,
  cohesion score.
- `Stats` (src/stats/index.ts:4): totals, per-tool, per-role, per-project,
  averages.
- Cluster: `{ centroid, entryIds }` (src/cluster/index.ts:20-21).

## 4. Flows

### 4.1 Sessions (src/sessions/index.ts:16-63)
`groupIntoSessions(entries, gapHours)` splits on idle gaps (default 2h);
`computeSessionCohesion` (:65) uses embedding similarity. CLI `ph sessions`
with `--gap-hours`, `--min-size`, `--no-cohesion`, `--export <n>` (markdown).

### 4.2 Stats (src/stats/index.ts:16)
`getStats(db)` computes totals + breakdowns; `ph stats` prints a table.

### 4.3 Cluster (src/cluster/index.ts)
K-means (maxIterations, convergence at cosine ≥ 0.9999) over embeddings;
`ph cluster -k N` prints the top prompts per cluster.

### 4.4 Timeline (src/commands/timeline.ts)
`ph timeline <project>` interleaves prompts + memories chronologically
(`getAllPromptsByProject` :740, `getAllMemoriesByProject` :774).

### 4.5 Context & chat
`ph context` outputs project memories + recent prompts as pipe-ready markdown
(`--prompts-only`, `--memories-only`, `--verbose`); `ph chat <tool> <prompt>`
injects that context into a tool run (Chat wrapper, SPEC-003 mode).

## 5. Invariants & Business rules
- Sessions split purely on time gaps (2h default) unless cohesion overrides.
- Cluster requires embeddings — without them the command errors/warns.
- Context output is markdown text (pipe-ready); memory section comes from
  `memories` + `project_summaries`.
- Timeline is ascending chronological (oldest → newest).

## 6. UI / UX surface
CLI tables/markdown; TUI chat mode (C key, SPEC-012) launches the tool with
context injected.

## 7. Acceptance criteria (Given/When/Then)
- **G1**: Given prompts 3h apart, When `groupIntoSessions(entries, 2)` runs,
  Then two sessions are produced (src/sessions/index.ts:16-63).
- **G2**: Given prompts 1h apart, When `groupIntoSessions(entries, 2)` runs,
  Then one session is produced (src/sessions/index.ts:16-63).
- **G3**: Given `getStats(db)`, When run, Then the returned Stats match the DB
  contents (src/stats/index.ts:16).
- **G4**: Given identical embedding vectors, When k-means runs with k=1, Then a
  single cluster contains all entries (src/cluster/index.ts:28-75).
- **G5**: Given `ph timeline ph`, When run, Then prompts and memories are
  interleaved in ascending order (src/commands/timeline.ts,
  db/index.ts:740-780).

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| Sessions + cohesion | src/sessions/index.ts:16-80 |
| Stats | src/stats/index.ts:16-60 |
| K-means cluster | src/cluster/index.ts:1-78 |
| Timeline | src/commands/timeline.ts |
| Context/chat | src/commands/context.ts, chat.ts |

## 9. Open questions / discrepancies
- Cohesion scoring cost is O(n²) embeddings comparisons; large histories make
  `ph sessions` slow (no cache).
- Cluster convergence threshold (0.9999) with 768-dim floats can oscillate —
  maxIterations is the real bound.
- `ph context` output format is duplicated between context.ts and the MCP
  get_project_context tool (SPEC-011) — drift risk.

## 10. Related
- SPEC-005/008 (inputs), SPEC-007 (memory inputs), SPEC-012 (TUI chat),
  SPEC-011 (MCP). No tests (SPEC-ISSUES-007) — G1/G2/G3 are vitest targets.
