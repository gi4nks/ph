# SPEC Template — use for every ph spec

> Copy this file to `docs/specs/SPEC-XXX-<slug>.md` and fill in. Keep it in **English**.
> Reverse-engineering rule: every claim must be traceable to code. When writing specs,
> cite `path:line` evidence. If behavior is ambiguous in code, record it in
> section 9 as an open question — never invent behavior.

```markdown
# SPEC-XXX: <Feature Name>

- **ID**: SPEC-XXX
- **Cluster**: Core | Capture | DB | AI | Search | Memory | Sync | MCP | TUI | Import | Analytics | Config
- **Status**: Draft | In Review | Accepted | Implemented
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
Why this feature exists, the problem it solves.

## 2. Scope
- **In scope**: …
- **Out of scope**: …
- **Entry points**: (ph commands, hooks, MCP tools, HTTP endpoints)

## 3. Data Model
Entities and fields the feature reads/writes.

## 4. Flows

### 4.1 Happy path
Numbered, concrete steps.

### 4.2 Edge cases & error handling
Known branches, validation failures, provider errors, concurrency notes.

## 5. Invariants & Business rules
- Rules that MUST never be violated.

## 6. UI / UX surface
TUI components, CLI output, keybindings.

## 7. Acceptance criteria (Given/When/Then)
- **G1**: Given … When … Then …
- **G2**: …
- **G3**: …

## 8. Key implementation map
| Concern | File(s) |
|---|---|

## 9. Open questions / discrepancies
- Any spec-vs-code mismatch, dead code, or undocumented behavior discovered.

## 10. Related
- Other SPEC ids, AGENTS.md notes, tests that exercise this feature.
```

## Rules of the road
1. Each MUST have ≥3 GWT acceptance criteria (they become vitest wiring later).
2. IDs are assigned in SPEC-INDEX.md — do NOT create new IDs.
3. One feature per file; files go to `docs/specs/SPEC-XXX-<slug>.md`.
4. Do not modify code. Read-only probe + `write_file` for the spec only.
5. Baseline specs (SPEC-001…) describe ph **as it is today** (regression targets).
   ph is an application: integration targets (harness-style) are not planned —
   keep specs baseline-only unless a target spec is explicitly requested.
