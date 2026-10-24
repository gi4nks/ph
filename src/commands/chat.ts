import { spawnSync } from 'child_process';
import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { detectProject } from '../runner/project.js';
import { resolveRealBinary } from '../runner/inline.js';
import { formatProjectContext } from '../context/index.js';
import { retrieveTaskContext } from '../knowledge/task-context.js';

export async function cmdChat(dbPath: string, cfg: PhConfig, args: string[]): Promise<void> {
  if (args.length === 0) {
    process.stderr.write('Usage: ph chat <tool> [tool-args...]\n');
    process.exit(1);
  }

  const tool = args[0];
  const userPrompt = args.slice(1).join(' ');
  if (!userPrompt) {
    process.stderr.write('ph chat: no prompt provided\n');
    process.exit(1);
  }

  const project = detectProject(process.cwd()).projectName;
  if (!project) {
    process.stderr.write('ph chat: could not detect project. Run from a project directory.\n');
    process.exit(1);
  }

  const db = new PhDB(dbPath);
  let context;
  let fallbackReason: string | undefined;
  try {
    const retrieved = await retrieveTaskContext(db, cfg, project, userPrompt, 5);
    context = retrieved.context;
    fallbackReason = retrieved.fallbackReason;
  } finally {
    db.close();
  }

  const contextStr = formatProjectContext(context);
  const fallbackLabel = fallbackReason
    ? `Context retrieval fallback: ${fallbackReason}. The following context is recent project history, not a semantic task match.\n\n`
    : '';
  const fullPrompt = `Context from project "${project}":\n\n${fallbackLabel}${contextStr}\n\n---\n\n${userPrompt}`;

  const realBin = resolveRealBinary(tool);
  const child = spawnSync(realBin, [fullPrompt], { stdio: 'inherit', cwd: process.cwd() });
  process.exit(child.status ?? 0);
}
