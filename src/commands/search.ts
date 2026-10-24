import { PhDB, cosineSimilarity } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import type { SearchOptions } from '../types.js';
import { getEmbeddings } from '../embedding/index.js';
import { printResults } from '../display/print.js';
import { decodePromptMetadata } from '../interaction/detail.js';
import { parseFlags, parseDate } from './_utils.js';
import { detectProject } from '../runner/project.js';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 1000;

export async function cmdSearch(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  const interactive = args.includes('-i') || args.includes('--interactive');
  const { flags, positional } = parseFlags(args.filter(arg => arg !== '-i' && arg !== '--interactive'));
  if (interactive) process.stderr.write('ph search -i now prints plain-text results; the interactive browser has been removed.\n');
  const query = positional.join(' ');
  const explicitProject = typeof flags.project === 'string' ? flags.project : undefined;
  const currentProject = detectProject(process.cwd()).projectName;
  const project = flags.all || flags.archive ? undefined : (explicitProject ?? (currentProject || undefined));
  const limit = parseLimit(flags.limit);

  if (flags.archive) process.stdout.write('Scope: archived work\n');
  else if (project) process.stdout.write(`Project: ${project}\n`);
  else if (flags.all) process.stdout.write('Scope: all projects\n');
  else process.stdout.write('Scope: all saved work (no project detected)\n');

  if (flags['archive']) {
    const archiveResults = db.searchArchive({
      since: flags['since'] ? new Date(flags['since'] as string).toISOString() : undefined,
      until: flags['until'] ? new Date(flags['until'] as string).toISOString() : undefined,
      limit,
    });
    if (archiveResults.length === 0) {
      console.log('No archived prompts found.');
      return;
    }
    console.log(`Found ${archiveResults.length} archived prompts:\n`);
    for (const r of archiveResults) {
      const date = new Date(r.timestamp as string).toLocaleString();
      const id = r.original_id ?? r.id;
      const full = Boolean(flags['full']);
      const promptRaw = r.prompt as string;
      const prompt = full ? promptRaw : promptRaw.replace(/\n/g, ' ').slice(0, 120);
      console.log(`  #${id} [${r.tool}] (${date})`);
      console.log(`    Prompt: ${prompt}${!full && promptRaw.length > 120 ? '...' : ''}`);
      if (r.response) {
        const responseRaw = r.response as string;
        const resp = full ? responseRaw : responseRaw.replace(/\n/g, ' ').slice(0, 120);
        console.log(`    Response: ${resp}${!full && responseRaw.length > 120 ? '...' : ''}`);
      }
      const metadata = decodePromptMetadata(String(r.metadata ?? '{}'));
      if (metadata.summary) console.log(`    Analysis: ${metadata.summary}`);
      console.log(`    Inspect: ph show ${id} --archive`);
      console.log();
    }
    return;
  }

  if (flags['semantic'] && query) {
    await cmdSearchSemantic(db, cfg, query, limit, Boolean(flags['full']), project);
    return;
  }

  const opts: SearchOptions = {
    query,
    tool: flags['tool'] as string | undefined,
    project,
    language: flags['language'] as string | undefined,
    role: flags['role'] as string | undefined,
    tag: flags['tag'] as string | undefined,
    starred: Boolean(flags['starred']),
    minQuality: flags['top'] ? 8 : (flags['min-quality'] ? Number(flags['min-quality']) : undefined),
    minRelevance: flags['min-relevance'] ? Number(flags['min-relevance']) : undefined,
    limit,
  };

  if (flags['since']) opts.since = parseDate(flags['since'] as string, '--since');
  if (flags['until']) {
    const d = parseDate(flags['until'] as string, '--until');
    d.setHours(23, 59, 59, 999);
    opts.until = d;
  }

  const results = db.search(opts);
  if (results.length === 0 && project) {
    process.stdout.write(query
      ? `No matches in ${project}. Use ph search --all to search other projects.\n`
      : `No saved work for ${project}. Use ph search --all to search all projects.\n`);
    return;
  }
  printResults(results, Boolean(flags['full']));
}

export async function cmdSearchSemantic(db: PhDB, cfg: PhConfig, query: string, limit: number, showFull: boolean, project?: string): Promise<void> {
  const ollamaUrl = cfg.ollamaUrl ?? 'http://localhost:11434';
  const model = cfg.ollamaEmbedModel ?? 'nomic-embed-text-v2-moe';

  process.stdout.write(`Searching semantically for: "${query}" (model: ${model})...\n`);

  const [queryVec] = await getEmbeddings([query], ollamaUrl, model, 1);
  if (!queryVec) {
    process.stderr.write('ph: failed to get embedding for query\n');
    process.exit(1);
  }

  const embeddings = project ? db.getEmbeddingsForProject(project) : db.getAllEmbeddings();
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

function parseLimit(raw: string | boolean | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return limit;
}
