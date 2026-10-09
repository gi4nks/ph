# SPEC-006: Analysis Pipeline (LLM)

- **ID**: SPEC-006
- **Cluster**: AI
- **Status**: Implemented (baseline)
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
Turns raw prompts into structured knowledge: role/tags/relevance/quality plus
summary/key_insights/technical_decisions via an LLM. Results feed metadata
(SPEC-002), memories and project summaries (SPEC-007).

## 2. Scope
- **In scope**: ANALYSIS_PROMPT, parseAnalysisResponse, analyzePrompt, mergeMetadata,
  analyzeAll, background analysis spawn, reusability scoring.
- **Out of scope**: provider details (src/ai/*), memory persistence (SPEC-007).
- **Entry points**: `ph analyze`, `ph analyze-reusability`, `_bg-analyze`,
  auto-analysis after `ph log` when `backgroundAnalysis` is enabled.

## 3. Data Model
- `AnalysisResult` (src/analyzer/index.ts:8-18): project, language, role, tags,
  relevance (0-10), quality (0-10), summary, key_insights, technical_decisions.
- `PromptMetadata` (src/types.ts:14-27) — analysis merged into it.
- `LLMProvider` interface (src/ai/provider.ts:5-12); factory `getProvider(cfg)`
  (:14) returns Ollama or Gemini.

## 4. Flows

### 4.1 Prompt (src/analyzer/index.ts:20-50)
`ANALYSIS_PROMPT(text)` demands a single JSON object with the exact field
contract; input truncated to 2000 chars (:49). No markdown fences allowed.

### 4.2 Parsing (src/analyzer/index.ts:56-120)
`parseAnalysisResponse` strips fences, extracts the first `{…}` block
(indexOf/lastIndexOf), JSON.parses; on failure returns `{}` (never throws).

### 4.3 Analyze + merge (src/analyzer/index.ts:123-183)
`analyzePrompt(text, provider)` → `parseAnalysisResponse(await provider.analyze…)`.
`mergeMetadata(existing, analysis, force?)` merges fields, preserving manual
metadata unless `force=true` (:136-183).

### 4.4 Batch (src/analyzer/index.ts:205)
`analyzeAll(db, provider, opts)` iterates unanalyzed prompts, updates metadata,
writes memories (SPEC-007). CLI `ph analyze` with `--limit/--force/--prune/
--dry-run`.

### 4.5 Background (src/background/analyzer.ts:7)
`spawnBackgroundAnalysis(id, dbPath)` spawns a detached `_bg-analyze` child —
never blocks the capture path. Enabled via `ph config set background-analysis true`.

### 4.6 Reusability (src/analyzer/reusability.ts)
`ph analyze-reusability` scores prompts for reuse; `cleanup-reusability`
deletes low-score ones (SPEC-009 cross-ref).

## 5. Invariants & Business rules
- Parsing NEVER throws — worst case is an empty AnalysisResult.
- Analysis is additive: manual fields survive unless `force`.
- Background analysis is detached: capture latency is never affected.
- Input truncated to 2000 chars before the LLM.

## 6. UI / UX surface
`ph analyze` progress output; TUI shows `●` (analyzed) vs `○` (pending) in
ListEntry (SPEC-012).

## 7. Acceptance criteria (Given/When/Then)
- **G1**: Given an LLM response with fenced JSON, When `parseAnalysisResponse`
  runs, Then the JSON is extracted and parsed (src/analyzer/index.ts:56-65).
- **G2**: Given a non-JSON response, When `parseAnalysisResponse` runs, Then
  `{}` is returned without throwing (src/analyzer/index.ts:61-70).
- **G3**: Given existing metadata with a manual role and analysis with a
  different role, When `mergeMetadata(existing, analysis)` runs without force,
  Then the manual role is preserved (src/analyzer/index.ts:136-183).
- **G4**: Given `force=true`, When `mergeMetadata` runs, Then the analysis
  values win (src/analyzer/index.ts:136-183).
- **G5**: Given `backgroundAnalysis: true`, When `ph log` runs, Then
  `spawnBackgroundAnalysis` is invoked with the new prompt id and dbPath
  (src/commands/log.ts:61-63, src/background/analyzer.ts:7).

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| Prompt + parse + merge + batch | src/analyzer/index.ts:20-275 |
| Providers + factory | src/ai/provider.ts:5-20, ollama.ts:8, gemini.ts:36 |
| Background spawn | src/background/analyzer.ts:7 |
| Reusability | src/analyzer/reusability.ts |

## 9. Open questions / discrepancies
- `parseAnalysisResponse` uses first/last brace — nested braces or multiple JSON
  blocks break extraction (same fragility class as lens's old regex plans).
- `_bg-analyze` passes only (id, dbPath): the child reloads config; a config
  change between capture and analysis silently changes the model used.
- Reusability scoring lives in analyzer/reusability.ts — verify the formula when
  wiring tests.

## 10. Related
- SPEC-002 (metadata update), SPEC-007 (memories), SPEC-015 (config),
  SPEC-004 (filter runs before analysis). No tests (SPEC-ISSUES-007).
