import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { detectProject } from '../runner/project.js';
import { parseFlags } from './_utils.js';
import { formatProjectContext, getProjectContext } from '../context/index.js';
import { retrieveTaskContext } from '../knowledge/task-context.js';
import { searchHubMemories } from './memory-hub.js';

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

  if (query) {
    const { context, fallbackReason } = await retrieveTaskContext(db, cfg, project, query, limit, {
      includeSummary: !promptsOnly,
      includeMemories: !promptsOnly,
      includePrompts: !memoriesOnly,
    });
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
    if (!promptsOnly) {
      try {
        const [work, projectMemories] = await Promise.all([
          searchHubMemories(cfg, query, 'work'),
          searchHubMemories(cfg, query, 'project'),
        ]);
        const shared = [...work, ...projectMemories];
        if (shared.length) {
          process.stdout.write('\n# Shared PH memory\n');
          for (const memory of shared) process.stdout.write(`- ${memory.content} [source: ${memory.source}${memory.source_ref ? ` · ${memory.source_ref}` : ''}]\n`);
        }
      } catch {
        process.stderr.write('ph: shared memory hub is unavailable; showing local project context only.\n');
      }
    }
    return;
  }

  const context = await getProjectContext(db, {
    project,
    query,
    limit,
    includeSummary: !promptsOnly,
    includeMemories: !promptsOnly,
    includePrompts: !memoriesOnly,
  });

  process.stdout.write(formatProjectContext(context, { includePromptText: verbose }) + '\n');
}
