# Project context retrieval evaluation

Two complementary evaluations are maintained:

- `src/context/__tests__/retrieval-eval.test.ts` is a deterministic regression
  test for SQLite ranking and project scoping. It uses fixed vectors and must
  remain independent of external services.
- `context-retrieval-golden.json` is a small maintainer-judged set of eight
  questions against ten project-history snippets, including two cross-project
  distractors. The relevance labels mean that a snippet directly answers the
  question or records a reusable decision. The snippets summarize documented
  ph behavior, rather than using private prompt-history data.

Run the model-backed evaluation with `npm run eval:retrieval`. It uses the
configured Ollama URL and embedding model, or `PH_OLLAMA_URL` and
`PH_EMBED_MODEL` overrides, embeds the corpus and queries, and reports Recall@5,
MRR, and each ranked result. The current database schema requires 768-dimensional
vectors. Review the relevance labels when behavior or terminology changes.

The deterministic fixture currently scores Recall@2 = 1.0 and MRR = 1.0.
These are implementation-regression results, not model-quality scores. No
model-backed score is recorded until the evaluator is run against a reachable
Ollama instance and the configured embedding model.

On 2026-10-09 the configured default endpoint `http://localhost:11434` refused
connections, so this run produced no model score. Start the local embedding
server or set `PH_OLLAMA_URL` to the intended reachable endpoint, then rerun.
