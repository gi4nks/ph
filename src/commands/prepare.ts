import type { PhConfig } from '../config/index.js';
import { formatProjectContext } from '../context/index.js';
import { retrieveTaskContext } from '../knowledge/task-context.js';
import type { PhDB } from '../db/index.js';
import { detectProject } from '../runner/project.js';
import { parseFlags } from './_utils.js';

export async function cmdPrepare(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const task = positional.join(' ').trim();
  if (!task) throw new Error('Usage: ph prepare "<task>" [--project <name>] [--limit <n>] [--budget <chars>]');
  const project = (flags.project as string | undefined) || detectProject(process.cwd()).projectName;
  if (!project) throw new Error('Could not detect project. Use --project <name>.');
  const limit = boundedInteger(flags.limit, 5, 1, 20, 'limit');
  const budget = boundedInteger(flags.budget, 3500, 500, 12000, 'budget');
  const { context, fallbackReason } = await retrieveTaskContext(db, cfg, project, task, limit);
  const warning = fallbackReason
    ? `Semantic retrieval unavailable (${fallbackReason}). Showing recent project context instead.`
    : '';
  process.stdout.write(`# Prepare: ${task}\nProject: ${project}\nMode: read-only${warning ? `\nWarning: ${warning}` : ''}\n\n`);
  process.stdout.write(formatProjectContext(context, {
    promptExcerptLength: 500,
    responseExcerptLength: 300,
    maxChars: budget,
    emptyMessage: `No saved knowledge found for project "${project}". This may be new work.`,
  }) + '\n');
}

function boundedInteger(value: string | boolean | undefined, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  return number;
}
