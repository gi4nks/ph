# SPEC-021: Lossless Unified Memory Migration

**Status:** Implemented in schema v4.

## Goal

Move historical memory records into the unified `memories` table without treating user data as disposable or losing provenance during the transition.

## Requirements

- Existing schema versions migrate inside one SQLite transaction under an immediate write lock.
- Existing unified-memory rows retain their IDs/content/status; new provenance fields default to `legacy` without rewriting content.
- Migrated personal-memory rows retain scope, sensitivity, source, exact source reference, original external ID, timestamps, forgotten timestamp, and available prompt IDs.
- Prior personal-memory versions are copied into `memory_versions` with their original change times and source fields.
- `project_summaries`, `personal_memories`, and `personal_memory_versions` are retained after backfill. The migration never drops these legacy tables.
- Reopening a v4 database is O(1) with respect to the current schema and does not duplicate backfill rows.
- A source prompt attached to a project-scoped memory must exist and its interaction project must exactly match the target project. Work-scoped sources can come from any project.
- Forget/restore records the prior memory state and timestamps transactionally.

## Verification

The migration fixture includes legacy project memory, personal-memory provenance, a prior version, and project summary metadata. Tests verify the unified row fields and retained source tables. Additional database tests reject cross-project provenance and accept matching sources.
