# SPEC-008: Embeddings (sqlite-vec)

- **ID**: SPEC-008
- **Cluster**: AI
- **Status**: Implemented (baseline)
- **Date**: 2026-08-08
- **Source**: reverse-engineered from code (files listed in §8)

## 1. Purpose
Semantic search capability: prompt text → vectors (Ollama embed API) → stored
in a sqlite-vec `vec0` virtual table with 768-dim; `searchSemantic` runs KNN
against a query vector. Backs `ph search --semantic`, MCP
`search_prompts_semantic`, HTTP `/api/prompts/semantic`, and cluster/cohesion.

## 2. Scope
- **In scope**: getEmbeddings (batching), saveEmbedding/getAllEmbeddings,
  searchSemantic, embed-all command, vec0 migration from legacy BLOB.
- **Out of scope**: the search UX (SPEC-005), clustering (SPEC-014).
- **Entry points**: `ph embed-all`, `ph search --semantic`, MCP, HTTP, background analysis.

## 3. Data Model
- `vec_embeddings` vec0 table: `embedding float[768]` (src/db/index.ts:100-104).
- Legacy `embeddings (prompt_id, vector BLOB)` (87-91) — migrated on open.
- Embedding dimension fixed at 768 (matches `nomic-embed-text-v2-moe` default,
  src/config/index.ts:14).

## 4. Flows

### 4.1 Generation (src/embedding/index.ts:5-34)
`getEmbeddings(texts, ollamaUrl, model, batchSize=20)` POSTs batches to
`{ollamaUrl}/api/embed`; throws on non-OK; returns `Float32Array[]`.

### 4.2 Persistence
`saveEmbedding(id, vector)` (src/db/index.ts:331) writes to vec_embeddings
(rowid = prompt id); `getAllEmbeddings()` (361) for cluster/cohesion;
`getPromptsWithoutEmbeddings()` (377) for embed-all.

### 4.3 Search (src/db/index.ts:345-360)
`searchSemantic(queryVector, limit)` — vec0 KNN: `SELECT … FROM vec_embeddings
WHERE embedding MATCH ? AND k = ?` joined to prompts.

### 4.4 Migration (src/db/index.ts:148-180)
If legacy `embeddings` has rows and `vec_embeddings` is empty: copy via
`vec_f32(?)`; also drops a non-vec0 table named vec_embeddings (95-98).

### 4.5 CLI (src/commands/embed-all.ts)
`ph embed-all` batches unembedded prompts, generates vectors, saves.

## 5. Invariants & Business rules
- Dimension is always 768; a mismatched model breaks KNN at runtime.
- vec_embeddings rowid == prompts.id (identity mapping).
- Migration runs on every open but is a no-op once done.
- Embedding failures throw — callers (embed-all, semantic search) surface the
  error instead of silently degrading.

## 6. UI / UX surface
`ph search --semantic` requires embeddings; CLI warns/errors when the model is
unreachable.

## 7. Acceptance criteria (Given/When/Then)
- **G1**: Given 50 texts with batchSize 20, When `getEmbeddings` runs, Then the
  Ollama API is called 3 times and 50 vectors are returned
  (src/embedding/index.ts:13-31).
- **G2**: Given a prompt with a saved embedding, When `searchSemantic` runs with
  the same vector, Then the prompt is the top result (src/db/index.ts:345-360).
- **G3**: Given legacy `embeddings` rows and an empty `vec_embeddings`, When the
  DB opens, Then the vectors are copied into vec_embeddings
  (src/db/index.ts:148-180).
- **G4**: Given `saveEmbedding(id, vec)`, When `getAllEmbeddings` runs, Then the
  map contains id → vec (src/db/index.ts:331-375).
- **G5**: Given a non-OK Ollama response, When `getEmbeddings` runs, Then it
  throws with the HTTP status (src/embedding/index.ts:22-25).

## 8. Key implementation map
| Concern | File(s) |
|---|---|
| Embed API client | src/embedding/index.ts:5-34 |
| vec0 persistence + KNN | src/db/index.ts:331-360 |
| Migration | src/db/index.ts:95-104, 148-180 |
| embed-all | src/commands/embed-all.ts |

## 9. Open questions / discrepancies
- 768 is hard-coded in the vec0 DDL; a model with a different dim fails at
  insert time with a vec0 error.
- `searchSemantic` runs KNN before filtering by project — the server filters in
  JS afterwards (src/server/index.ts:81-89); large DBs pay KNN cost first.

## 10. Related
- SPEC-005 (semantic search), SPEC-014 (cluster/cohesion use embeddings),
  SPEC-010 (HTTP semantic endpoint). No tests (SPEC-ISSUES-007).
