# SPEC-013: Importers (Claude / Gemini / OpenCode)

- **ID**: SPEC-013
- **Cluster**: Import
- **Status**: Implemented (baseline)
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
Bootstrap history from existing AI CLI session stores: Claude Code (JSONL),
Gemini CLI (JSONL), OpenCode (SQLite at `~/.local/share/opencode/opencode.db`).
All imports route through the filter pipeline (SPEC-004) and can trigger inline
LLM analysis (`--analyze`).

## 2. Scope
- **In scope**: three importer modules, import command flow, dedup, dry-run,
  filter/analyze flags.
- **Out of scope**: real-time capture (SPEC-003), remote import.
- **Entry points**: `ph import gemini|claude|opencode [--dry-run] [--analyze] [--filter]`.

## 3. Data Model
- `ImportResult` (src/types.ts:70-77): filesScanned, promptsFound,
  promptsImported, skipped, filtered, errors.
- Sources: Claude JSONL sessions; Gemini JSONL; OpenCode `opencode.db`
  (`session`/`message`/`part` tables; assistant→user link via `parentID` in
  `message.data`).

## 4. Flows

### 4.1 Claude/Gemini (src/importer/claude.ts, gemini.ts)
1. Locate session stores in `~/.claude` / `~/.gemini` (JSONL).
2. Parse pairs (prompt + response); apply filter pipeline; dedup vs existing
   (by prompt hash or content).
3. Insert via PhDB; `--analyze` runs inline analysis per imported prompt.

### 4.2 OpenCode (src/importer/opencode.ts)
1. Read `~/.local/share/opencode/opencode.db` (better-sqlite3).
2. Pair user messages with assistant responses (parentID join).
3. Dedup (existing prompt check), insert, optional analyze.
   Reference run: 186 pairs found → 151 imported (AGENTS.md).

### 4.3 Command flow (src/commands/import.ts)
`cmdImport(db, cfg, args)` dispatches by source; `--dry-run` reports counts
without inserting; `--filter` enables the pipeline; `--analyze` runs LLM
analysis inline.

## 5. Invariants & Business rules
- Imports never duplicate existing prompts (content-based dedup).
- `--dry-run` performs no writes.
- OpenCode source DB is opened read-only (never modified).
- Imported prompts carry the source tool name (`claude`/`gemini`/`opencode`).

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

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| Claude importer | src/importer/claude.ts |
| Gemini importer | src/importer/gemini.ts |
| OpenCode importer | src/importer/opencode.ts |
| Command dispatch | src/commands/import.ts |

## 9. Open questions / discrepancies
- Claude/Gemini store discovery paths are version-specific — a CLI update can
  break pairing silently (returns empty).
- OpenCode parentID pairing relies on `message.data` JSON shape; schema drift in
  opencode.db breaks imports.
- Exact dedup key per importer (prompt hash vs tool+prompt) needs verification
  when writing GWT tests.

## 10. Related
- SPEC-002 (insert), SPEC-004 (filter), SPEC-006 (analyze). No tests
  (SPEC-ISSUES-007) — G2/G3 are testable with fixture files.
