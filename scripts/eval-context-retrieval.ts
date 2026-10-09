import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PhDB } from '../src/db/index.js';
import { getEmbeddings } from '../src/embedding/index.js';

interface Dataset {
  documents: Array<{ id: string; project: string; text: string }>;
  queries: Array<{ query: string; relevant: string[] }>;
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'docs/evals/context-retrieval-golden.json'), 'utf8')) as Dataset;
const configPath = path.join(os.homedir(), '.ph_config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) as { ollamaUrl?: string; ollamaEmbedModel?: string } : {};
const baseUrl = process.env.PH_OLLAMA_URL ?? config.ollamaUrl ?? 'http://localhost:11434';
const model = process.env.PH_EMBED_MODEL ?? config.ollamaEmbedModel ?? 'nomic-embed-text-v2-moe';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-retrieval-eval-'));
const db = new PhDB(path.join(dir, 'eval.db'));

try {
  const documentVectors = await getEmbeddings(dataset.documents.map(doc => doc.text), baseUrl, model);
  if (documentVectors.some(vector => vector.length !== 768)) {
    throw new Error(`The configured sqlite-vec table requires 768 dimensions; ${model} returned ${documentVectors[0]?.length ?? 0}.`);
  }
  const ids = new Map<string, number>();
  for (let i = 0; i < dataset.documents.length; i++) {
    const doc = dataset.documents[i];
    const id = db.insert({ timestamp: new Date(0).toISOString(), tool: 'eval', prompt: doc.text, response: '', args: '', workdir: '', hostname: 'eval', exit_code: 0, metadata: JSON.stringify({ project: doc.project, evalId: doc.id }) });
    ids.set(doc.id, id);
    db.saveEmbedding(id, documentVectors[i]);
  }

  let reciprocalRank = 0;
  let recalled = 0;
  const cases = [];
  for (const item of dataset.queries) {
    const [queryVector] = await getEmbeddings([item.query], baseUrl, model, 1);
    const ranked = db.searchSemantic(queryVector, 5).map(entry => JSON.parse(entry.metadata) as { evalId: string }).map(meta => meta.evalId);
    const rank = ranked.findIndex(id => item.relevant.includes(id));
    if (rank >= 0) { recalled++; reciprocalRank += 1 / (rank + 1); }
    cases.push({ query: item.query, relevant: item.relevant, top5: ranked, firstRelevantRank: rank < 0 ? null : rank + 1 });
  }
  console.log(JSON.stringify({ model, baseUrl, queries: dataset.queries.length, recallAt5: recalled / dataset.queries.length, mrr: reciprocalRank / dataset.queries.length, cases }, null, 2));
} finally {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
