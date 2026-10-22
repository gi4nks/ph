# Work Plan: Making ph an Operational Memory

**Date:** 2026-10-10
**Status:** Phases 0–3 implemented; Phase 4 deferred until real usage feedback is available.

**Product decision:** Guide the `prepare → work → review → promote` cycle by reusing existing retrieval, memories, summaries, and MCP tools.
**Analysis:** [From Prompt History to Operational Memory](../ph-operational-memory-analysis.html)

## Goal

At the start of a task, ph should retrieve relevant prior work and show its sources. At the end, it should help preserve reusable decisions and procedures, always with explicit user approval.

Success means reducing context that must be explained again and work that must be repeated, rather than increasing the number of analyzed prompts.

## Current State and Implications

- `getProjectContext()` is shared by `ph context`, `ph chat`, and MCP. It supports project summaries, memories, and relevant interactions.
- Memories include `prompt_ids`, but MCP `save_decision` previously created decisions with `prompt_ids: []`.
- `project_summaries` aggregates insights and decisions; `memories` preserves the detailed history.
- `check_project_knowledge` and `get_project_context` are already available through MCP. The first slice should improve reuse of evidence rather than add a second memory system.
- Deterministic context retrieval tests and a small golden set already exist. The evaluation set should be expanded before retrieval is optimized.

## Architecture

```text
User task
    │
    ▼
ph prepare ──► shared retrieval ──► compact brief + sources
                                      │
                                      ▼
                                  AI work
                                      │
                                      ▼
ph close ──► selected prompts ──► knowledge proposals
                                      │
                               user approval
                                      │
                                      ▼
                    memories(prompt_ids) + project_summaries
                                      │
                                      └────► CLI / MCP / next prepare
```

## Phases

### Phase 0 — Retrieval Contract and Evaluation

**Purpose:** Define what makes a result useful and establish a baseline before changing search behavior.

**Activities**

- Expand `docs/evals/context-retrieval-golden.json` with queries across multiple projects, covering decisions, resolved bugs, procedures, and models/providers.
- Label each case with relevant prompt or memory IDs, the project, and examples of misleading results.
- Record a `Recall@3` baseline and manually review relevance; do not optimize for result volume.
- Define source references using memory ID, prompt ID, date, tool, and project.

**Acceptance criteria**

- At least 12 judged queries across at least four projects.
- Results distinguish “no evidence” from “evidence found.”
- The evaluation test reports repeatable metrics without calling a generative LLM.

### Phase 1 — `ph prepare`: Prepare for a Task

**Interface**

```bash
ph prepare "add the Wise provider to ph"
ph prepare "diagnose the SQLite lock" --project picot --limit 5
ph prepare "evaluate MLX-Serve" --budget 3500
```

**Activities**

- Add `src/commands/prepare.ts` and connect it to `src/cli.ts`.
- Reuse `getProjectContext()` and `formatProjectContext()`; do not duplicate retrieval or formatting in a new service.
- Detect the project from the current directory, with an explicit `--project` override.
- Use the task as a semantic query and provide a clear fallback when Ollama embeddings are unavailable.
- Print a compact brief with decisions, gotchas, prior work, and sources (`memory #N`, `prompt #N`, date, and tool).
- Add an output budget. Truncate raw interactions first and preserve source IDs.
- Keep `ph context` compatible and document the distinction: `context` explores; `prepare` creates a brief for a task.

**Acceptance criteria**

- `prepare` does not write to the database.
- It makes no generative LLM call; local embeddings are used only for semantic retrieval.
- Output is reproducible, bounded by the content budget, and has traceable sources.
- An explicit `--project` prevents project mixing; a missing detected project gives a clear instruction.
- A query with no results does not invent knowledge and says so.

### Phase 2 — `ph close`: Propose What to Keep

**Interface**

```bash
ph close --since 3h
ph close --from 1670 --to 1682
ph close --dry-run --since 3h
```

**Activities**

- Add `src/commands/close.ts`; reuse `PhDB`, `LLMProvider`, and the existing `save_decision` persistence behavior where applicable.
- Select inputs explicitly by project and time window or ID range. Show how many prompt/response pairs will be included before generation.
- Make one optional analysis call to propose zero or more decisions/insights, without promoting them automatically.
- Show proposed text, sources, and destination fields; allow approval, text editing, or cancellation.
- After approval, append memories with their source prompt IDs and update `project_summaries`.
- Extend MCP `save_decision` with optional `promptIds`; validate that IDs exist and belong to the declared project.
- Avoid new tables or knowledge types in the first release. Store decisions and procedures in existing fields.

**Acceptance criteria**

- `--dry-run` performs no writes.
- Cancelling review does not change `memories` or `project_summaries`.
- Each approved proposal retains at least one source ID.
- A prompt from another project cannot be attached accidentally.
- The aggregate summary remains consistent and detailed memories remain append-only.
- Provider errors, missing providers, and malformed responses do not cause partial promotion.

### Phase 3 — Bring the Workflow to Agents Through MCP

**Activities**

- Make `check_project_knowledge` semantically relevant by reusing `getProjectContext()` instead of substring matching memories alone.
- Include sources and a clear outcome: knowledge found, partial evidence, or no evidence.
- Reuse MCP `save_decision` for end-of-task promotion, with source references.
- Document a client-neutral agent workflow for Codex, OpenCode, and other MCP clients.
- Do not inject context into every prompt automatically; the client or user invokes preflight when a meaningful task begins.

**Acceptance criteria**

- The same evaluation case returns the same evidence from `ph prepare` and MCP.
- MCP tools do not expose content from other projects.
- Promotion preserves source `prompt_ids` validated by the server.

### Phase 4 — Feedback and Knowledge Maintenance

**Deferred until Phases 1–3 have been used on real work.**

- Add `ph feedback <memory-id> useful|irrelevant|stale` and an MCP equivalent only if agents need them.
- Decide whether feedback belongs in a separate event table or updateable memory fields; preserve history if judgments can change over time.
- Use feedback and access counts for ranking and review, not automatic deletion.
- Add a review command for old or contradicted decisions, with sources and last verification date.

**Gate:** proceed only after `prepare` is used on real tasks and some results are confirmed useful. Do not add complex ranking before feedback exists.

## Decisions and Trade-offs

| Topic | Decision | Rationale and cost |
|---|---|---|
| Entry points | Add `prepare` and `close`, keep `context` | The names describe two work moments; existing scripts remain compatible. |
| Promotion | Require human approval before writes | Adds a step while preventing false or noisy permanent memory. |
| Sources | Reuse `MemoryEntry.prompt_ids` | The field already exists; the main gap was MCP persistence. |
| Data model | No new tables in Phases 0–3 | Existing summaries, insights, decisions, and sources are sufficient for the first validation. |
| Retrieval | Prioritize relevance and project scoping before personalization | Reduces cross-project contamination and supports deterministic measurement. |
| Automation | No global auto-injection or auto-promotion in the MVP | Avoids noise, wasted tokens, and silent changes. |

## Cost, Rate Limits, and Latency

- **Prepare:** SQLite is local. Semantic retrieval uses the configured embedding endpoint (Ollama by default); it adds a request and local-server latency, but no generative cloud call.
- **Close:** One LLM request creates proposals. OpenRouter may incur cost and rate limits; MLX-Serve depends on the tunnel, loaded model, and available memory. Users choose the configured provider and approve before writing.
- **Budget:** Limit included prompt/response text, show the number of sources, and apply an explicit budget to the `prepare` brief. Do not hide truncation.
- **Degraded operation:** If embeddings or the provider are unavailable, keep search and manual saving usable and identify the unavailable step without fabricating results.

## Definition of Done

- Existing tests remain green. New tests cover sources/projects, output budget, dry-run, cancellation, and `promptIds` validation.
- Golden set has at least 12 queries with an initial `Recall@3 ≥ 0.8` target and manual review of misses. Recalibrate if the labels show that the set is insufficient.
- Three real tasks across different projects complete the workflow; the user can judge whether the brief prevented repeated decisions or investigation.
- Every promoted item links to its evidence; unapproved work never changes curated memory.
- README and manual document `prepare`, `close`, provider configuration, costs, and offline behavior.

## Usage Check (2026-10-10)

Using an isolated temporary database seeded with one sample prompt:

- `ph prepare "project cache path" --project ph --limit 3 --budget 1200` displayed the matching prompt and response with their source ID. Ollama embeddings were unavailable, and the command clearly reported that it was using recent project context instead.
- `ph close --from 1 --to 1 --project ph --dry-run` displayed the selected prompt and response, then confirmed that it made no model call and no database changes.
- The configured direct localhost route to MLX-Serve failed. An SSH port forward to Parmenide (`18034 → 127.0.0.1:11234`) restored connectivity. Interactive `ph close` generated a proposal, accepted approval, and saved memory `#1` linked to prompt `#1` in the temporary database.
- `ph context --memories-only --project ph` then returned the saved summary, insights, decisions, and `prompt #1` provenance. The generated proposal added plausible details beyond the sample evidence, reinforcing the need to inspect and edit proposals before approval.
- The full usage path was exercised on the temporary database only; no user history or project memory was changed.

## Delivery Order

1. Phase 0: evaluation cases and source contract.
2. Phase 1: read-only `prepare`.
3. Phase 2: `close` with preview, approval, and provenance.
4. Phase 3: shared retrieval and promotion through MCP.
5. Phase 4: explicit feedback and review after real usage.

Each phase can ship as a separate change. The first operational version is complete with Phases 0–3; Phase 4 depends on observing real usage and can be planned separately.
