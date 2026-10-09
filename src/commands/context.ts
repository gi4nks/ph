import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { getEmbeddings } from '../embedding/index.js';
import { detectProject } from '../runner/project.js';
import { parseFlags } from './_utils.js';
import { formatProjectContext, getProjectContext } from '../context/index.js';

export async function cmdContext(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const query = positional.join(' ');
  const project = (flags['project'] as string) || detectProject(process.cwd()).projectName;
  const limit = Number(flags['limit'] ?? 5);
  const promptsOnly = Boolean(flags['prompts-only']);
  const memoriesOnly = Boolean(flags['memories-only']);
  const verbose = Boolean(flags['verbose']);

  if (!project) {
    process.stderr.write('ph: could not detect project. Use --project <name>\n');
    process.exit(1);
  }

  const ollamaUrl = cfg.ollamaUrl ?? 'http://localhost:11434';
  const model = cfg.ollamaEmbedModel ?? 'nomic-embed-text-v2-moe';
  const context = await getProjectContext(db, {
    project,
    query,
    limit,
    includeSummary: !promptsOnly,
    includeMemories: !promptsOnly,
    includePrompts: !memoriesOnly,
  }, async (text) => {
    const [vector] = await getEmbeddings([text], ollamaUrl, model, 1);
    return vector;
  });

  process.stdout.write(formatProjectContext(context, { includePromptText: verbose }) + '\n');
}
