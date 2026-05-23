import { PhDB, cosineSimilarity } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import type { SearchOptions } from '../types.js';
import { getEmbeddings } from '../embedding/index.js';
import { printResults } from '../display/print.js';
import { parseFlags, parseDate } from './_utils.js';

export async function cmdSearch(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const query = positional.join(' ');

  if (flags['semantic'] && query) {
    await cmdSearchSemantic(db, cfg, query, Number(flags['limit'] ?? 50), Boolean(flags['full']));
    return;
  }

  const opts: SearchOptions = {
    query,
    tool: flags['tool'] as string | undefined,
    project: flags['project'] as string | undefined,
    language: flags['language'] as string | undefined,
    role: flags['role'] as string | undefined,
    tag: flags['tag'] as string | undefined,
    starred: Boolean(flags['starred']),
    minQuality: flags['top'] ? 8 : (flags['min-quality'] ? Number(flags['min-quality']) : undefined),
    minRelevance: flags['min-relevance'] ? Number(flags['min-relevance']) : undefined,
    limit: Number(flags['limit'] ?? 50),
  };

  if (flags['since']) opts.since = parseDate(flags['since'] as string, '--since');
  if (flags['until']) {
    const d = parseDate(flags['until'] as string, '--until');
    d.setHours(23, 59, 59, 999);
    opts.until = d;
  }

  const results = db.search(opts);
  printResults(results, Boolean(flags['full']));
}

export async function cmdSearchSemantic(db: PhDB, cfg: PhConfig, query: string, limit: number, showFull: boolean): Promise<void> {
  const ollamaUrl = cfg.ollamaUrl ?? 'http://localhost:11434';
  const model = cfg.ollamaEmbedModel ?? 'nomic-embed-text-v2-moe';

  process.stdout.write(`Searching semantically for: "${query}" (model: ${model})...\n`);

  const [queryVec] = await getEmbeddings([query], ollamaUrl, model, 1);
  if (!queryVec) {
    process.stderr.write('ph: failed to get embedding for query\n');
    process.exit(1);
  }

  const embeddings = db.getAllEmbeddings();
  const scores: Array<{ id: number; sim: number }> = [];

  for (const [id, vec] of embeddings) {
    const sim = cosineSimilarity(queryVec, vec);
    if (sim > 0.3) scores.push({ id, sim });
  }

  scores.sort((a, b) => b.sim - a.sim);
  const topScores = scores.slice(0, limit);

  const results = topScores
    .map(({ id }) => db.getById(id))
    .filter((e): e is NonNullable<typeof e> => e !== undefined);

  printResults(results, showFull);
}
