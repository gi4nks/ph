# SPEC-004: Filter Pipeline & Metadata

- **ID**: SPEC-004
- **Cluster**: Core
- **Status**: Implemented (baseline)
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
Keeps noise out of the history: `FilterPipeline` rejects too-short, binary,
trivial and duplicate prompts before they reach the DB, and enriches entries
with project/language/topic metadata at capture time.

## 2. Scope
- **In scope**: FilterPipeline checks, FilterResult, metadata enrichment
  (detectProject, detectLanguage, extractTopic), filter config knobs.
- **Out of scope**: LLM analysis (SPEC-006), retention (SPEC-009).
- **Entry points**: FilterPipeline used by `ph log` / importers; metadata
  helpers used across commands.

## 3. Data Model
- `FilterReason` union + `FilterResult` (src/filter/index.ts:4-11): `{ pass,
  reason? }`.
- `FilterOptions` (src/filter/index.ts:17): minLength, minRelevance.
- Metadata JSON shape `PromptMetadata` (src/types.ts:14-27).

## 4. Flows

### 4.1 Filtering (src/filter/index.ts:34)
`FilterPipeline.check(text)` runs 4 checks (AGENTS.md + filter/index.ts):
1. too short (< `filterMinLength`, default 15)
2. non-printable characters
3. trivial pattern (e.g. single words, "ok", "yes")
4. exact duplicate (against recent history)
Optional relevance check when `minRelevance > 0`.

### 4.2 Enrichment
- `detectProject(startDir)` walks up looking for `.git`/`go.mod`/`package.json`/
  `Cargo.toml` (src/runner/project.ts:25).
- `detectLanguage(rootDir)` (src/runner/project.ts:40).
- `extractTopic(prompt)` (src/utils/extractTopic.ts:5) — title-like extraction.
- Assembled into `metadata` JSON before insert (e.g. src/commands/log.ts:50-58).

## 5. Invariants & Business rules
- Filtered prompts never reach the DB (importers and log both call the pipeline).
- Metadata merge later (SPEC-006) preserves manual fields unless `force`.
- `filterMinRelevance` default 3 — but relevance only exists after analysis, so
  the check only bites on re-analysis paths.

## 6. UI / UX surface
Filter counts/reasons are logged at capture time; configurable via
`ph config set filter-min-length <n>` etc.

## 7. Acceptance criteria (Given/When/Then)
- **G1**: Given a 5-char prompt with `minLength: 15`, When `FilterPipeline.check`
  runs, Then `{ pass: false, reason: 'too short' }` (src/filter/index.ts:34+).
- **G2**: Given a prompt with control bytes, When `check` runs, Then it is
  rejected as non-printable (src/filter/index.ts).
- **G3**: Given a prompt equal to an existing recent entry, When `check` runs,
  Then it is rejected as duplicate (src/filter/index.ts).
- **G4**: Given a dir containing `package.json`, When `detectProject` runs, Then
  the project name is derived from the package (src/runner/project.ts:25-39).
- **G5**: Given `extractTopic("fix the login bug")`, When run, Then a short
  topic string is returned (src/utils/extractTopic.ts:5).

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| FilterPipeline + reasons | src/filter/index.ts:4-80 |
| Project/language detection | src/runner/project.ts:25-60 |
| Topic extraction | src/utils/extractTopic.ts:5 |
| Capture-time assembly | src/commands/log.ts:50-58 |

## 9. Open questions / discrepancies
- The exact trivial-pattern list lives inline in filter/index.ts; verify the
  regexes when wiring GWT tests.
- Duplicate check scope (recent history window vs all) is implementation detail
  in filter/index.ts — confirm before writing the G3 test.

## 10. Related
- SPEC-002 (insert), SPEC-003 (capture), SPEC-013 (importers reuse the filter),
  SPEC-015 (config keys). No tests exist (SPEC-ISSUES-007).
