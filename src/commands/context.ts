import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { getEmbeddings } from '../embedding/index.js';
import { detectProject } from '../runner/project.js';
import { parseFlags } from './_utils.js';
import { formatProjectContext, getProjectContext } from '../context/index.js';
import { retrieveTaskContext } from '../knowledge/task-context.js';

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

  if (query && !promptsOnly && !memoriesOnly) {
    const { context, fallbackReason } = await retrieveTaskContext(db, cfg, project, query, limit);
    const requestedBudget = flags['budget'];
    const budget = typeof requestedBudget === 'string' ? Number(requestedBudget) : 3500;
    const warning = fallbackReason
      ? `\nRetrieval fallback: ${fallbackReason}. Showing recent project context.\n`
      : '';
    process.stdout.write(`# Project context: ${query}\nProject: ${project}${warning}\n`);
    process.stdout.write(formatProjectContext(context, {
      ...(!verbose ? { promptExcerptLength: 500 } : { includePromptText: true }),
      responseExcerptLength: 300,
      maxChars: Number.isInteger(budget) && budget >= 500 && budget <= 12000 ? budget : 3500,
      emptyMessage: `No saved knowledge found for project "${project}". This may be new work.`,
    }) + '\n');
    return;
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
