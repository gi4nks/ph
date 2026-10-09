# SPEC-013: Importers (Claude / Gemini / OpenCode / Codex)

- **ID**: SPEC-013
- **Cluster**: Import
- **Status**: Implemented
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
Bootstrap history from existing AI CLI session stores: Claude Code (JSONL),
Gemini CLI (JSONL), OpenCode (SQLite at `~/.local/share/opencode/opencode.db`),
and Codex CLI rollout JSONL files under `~/.codex/sessions/`.
All imports route through the filter pipeline (SPEC-004) and can trigger inline
LLM analysis (`--analyze`).

## 2. Scope
- **In scope**: four importer modules, import command flow, dedup, dry-run,
  filter/analyze flags.
- **Out of scope**: real-time capture (SPEC-003), remote import.
- **Entry points**: `ph import gemini|claude|opencode|codex [--dry-run] [--analyze] [--filter]`; Codex also accepts `--file <transcript>`.

## 3. Data Model
- `ImportResult` (src/types.ts:70-77): filesScanned, promptsFound,
  promptsImported, skipped, filtered, errors.
- Sources: Claude JSONL sessions; Gemini session JSON; OpenCode `opencode.db`
  (`session`/`message`/`part` tables; assistant→user link via `parentID` in
  `message.data`); Codex rollout JSONL.

## 4. Flows

### 4.1 Claude/Gemini (src/importer/claude.ts, gemini.ts)
1. Locate session stores in `~/.claude` / `~/.gemini` (JSONL).
2. Parse pairs (prompt + response); apply filter pipeline; dedup vs existing
   (by prompt hash or content).
3. Normalize and insert via `createCaptureRecord` in PhDB; `--analyze` runs
   inline analysis per imported prompt.

### 4.2 OpenCode (src/importer/opencode.ts)
1. Read `~/.local/share/opencode/opencode.db` (better-sqlite3).
2. Pair user messages with assistant responses (parentID join).
3. Dedup (existing prompt check), insert, optional analyze.
   Reference run: 186 pairs found → 151 imported (AGENTS.md).

### 4.3 Command flow (src/commands/import.ts)
`cmdImport(db, cfg, args)` dispatches by source; `--dry-run` reports counts
without inserting; `--filter` enables the pipeline; `--analyze` runs LLM
analysis inline.

### 4.4 Codex (src/importer/codex.ts)
1. Recursively scan `~/.codex/sessions/` for `rollout-*.jsonl`, or use the
   transcript passed with `--file` by the Codex Stop hook.
2. Read `session_meta` for session ID and working directory; pair legacy
   `event_msg.user_message` records or modern `response_item` messages with
   `role=user` with the following assistant response. Prefer assistant messages
   with `phase=final_answer` over commentary when that phase is present.
3. Insert through the normalized capture record and content dedup filter.

## 5. Invariants & Business rules
- Imports never duplicate existing prompts (content-based dedup).
- `--dry-run` performs no writes.
- OpenCode source DB is opened read-only (never modified).
- Imported prompts carry the source tool name (`claude`/`gemini`/`opencode`/`codex`).
- Importers share the capture record shape and retain source-specific metadata.

## 6. UI / UX surface
CLI summary: `Files scanned / prompts found / imported / skipped / filtered`.

## 7. Acceptance criteria (Given/When/Then)
- **G1**: Given a Claude JSONL with one session, When `importer/claude` runs,
  Then a prompt+response pair is produced (src/importer/claude.ts).
- **G2**: Given an already-imported prompt, When the importer runs again, Then
  it is skipped (not duplicated) (src/importer/claude.ts dedup path).
- **G3**: Given `--dry-run`, When `cmdImport` runs, Then no rows are inserted
  and counts are reported (src/commands/import.ts).
- **G4**: Given `--analyze`, When an import runs, Then analysis runs inline for
  each imported prompt (SPEC-006).
- **G5**: Given `--filter`, When an import runs, Then FilterPipeline rejects
  noise before insert (SPEC-004).
- **G6**: Given a Codex rollout with user and agent events, When the Codex
  importer runs, Then it stores paired text with the session working directory
  and does not duplicate the turn on a subsequent import.

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| Claude importer | src/importer/claude.ts |
| Gemini importer | src/importer/gemini.ts |
| OpenCode importer | src/importer/opencode.ts |
| Codex importer | src/importer/codex.ts |
| Command dispatch | src/commands/import.ts |
| Normalized insertion | src/capture/index.ts |

## 9. Open questions / discrepancies
- Claude JSONL, Gemini session JSON, OpenCode SQLite, and Codex rollout fixtures verify
  prompt/response pairing and imported workdir against a temporary `PhDB`.
- Claude/Gemini store discovery paths are version-specific — a CLI update can
  break pairing silently (returns empty).
- OpenCode parentID pairing relies on `message.data` JSON shape; schema drift in
  opencode.db breaks imports.
- Codex transcript paths and rollout formats are not stable hook interfaces;
  unknown or malformed JSONL records are ignored. The importer supports both
  `event_msg` user/agent messages and `response_item` user/assistant messages.
- Shared content dedup hashes prompt text across tools; repeated user prompts
  from different tools collapse under this policy.

## 10. Related
- SPEC-002 (insert), SPEC-004 (filter), SPEC-006 (analyze). Source-format
  importer tests still need fixtures (SPEC-ISSUES-007); normalized record
  behavior is covered in `src/capture/__tests__/record.test.ts`.
