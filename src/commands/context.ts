import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { detectProject } from '../runner/project.js';
import { parseFlags } from './_utils.js';
import { configuredEmbedder, formatCombinedContext } from '../context/index.js';
import { MemoryService } from '../memory/service.js';

function parseBudget(raw: string | boolean | undefined): number {
  if (raw === undefined || raw === true) return 3500;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 3500;
  return Math.max(500, Math.min(12000, Math.floor(parsed)));
}

export async function cmdContext(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const query = positional.join(' ').trim();
  const project = (flags['project'] as string) || detectProject(process.cwd()).projectName;
  const limit = Number(flags['limit'] ?? 5);
  const promptsOnly = Boolean(flags['prompts-only']);
  const memoriesOnly = Boolean(flags['memories-only']);
  const full = Boolean(flags['full'] || flags['verbose']);

  if (!project) {
    process.stderr.write('ph: could not detect project. Use --project <name>\n');
    process.exit(1);
  }

  const memoryService = new MemoryService(db, cfg);
  const { context, shared: sharedMemories } = await memoryService.projectContext({
    project,
    query,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 20) : 5,
    includeMemories: !promptsOnly,
    includePrompts: !memoriesOnly,
  }, configuredEmbedder(cfg));

  const budget = parseBudget(flags['budget'] ?? flags['max-chars']);
  const notes = context.notes.length ? `\nRetrieval: ${context.notes.join('; ')}.` : '';
  const header = query
    ? `# Project context: ${query}\nProject: ${project}${notes}`
    : `# Project context\nProject: ${project}${notes}`;

  const rendered = formatCombinedContext(context, sharedMemories, {
    header,
    full,
    ...(full ? { includePromptText: true } : { promptExcerptLength: 500 }),
    responseExcerptLength: 300,
    maxChars: budget,
    emptyMessage: `No saved knowledge found for project "${project}". This may be new work.`,
  });
  process.stdout.write(`${rendered}\n`);
}
