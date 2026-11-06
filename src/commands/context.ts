import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { detectProject } from '../runner/project.js';
import { parseFlags } from './_utils.js';
import { configuredEmbedder, formatProjectContext } from '../context/index.js';
import { MemoryService } from '../memory/service.js';

export async function cmdContext(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const query = positional.join(' ').trim();
  const project = (flags['project'] as string) || detectProject(process.cwd()).projectName;
  const limit = Number(flags['limit'] ?? 5);
  const promptsOnly = Boolean(flags['prompts-only']);
  const memoriesOnly = Boolean(flags['memories-only']);
  const verbose = Boolean(flags['verbose']);

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

  const requestedBudget = flags['budget'];
  const budget = typeof requestedBudget === 'string' ? Number(requestedBudget) : 3500;
  const notes = context.notes.length ? `\nRetrieval: ${context.notes.join('; ')}.\n` : '';

  process.stdout.write(query
    ? `# Project context: ${query}\nProject: ${project}${notes}\n`
    : `# Project context\nProject: ${project}${notes}\n`);
  const localContext = formatProjectContext(context, {
    ...(verbose ? { includePromptText: true } : { promptExcerptLength: 500 }),
    responseExcerptLength: 300,
    maxChars: Number.isInteger(budget) && budget >= 500 && budget <= 12000 ? budget : 3500,
    emptyMessage: `No saved knowledge found for project "${project}". This may be new work.`,
  });
  const sharedContext = sharedMemories.length
    ? `## Shared PH Memory\n\n${sharedMemories.map(memory => `- [${String(memory.kind ?? 'fact')} · ${String(memory.scope ?? 'work')}${memory.project ? `:${String(memory.project)}` : ''}; source ${String(memory.source_ref ?? memory.source ?? 'unspecified')}] ${String(memory.content ?? '')}`).join('\n')}`
    : '';
  process.stdout.write([sharedContext, localContext].filter(Boolean).join('\n\n') + '\n');
}
