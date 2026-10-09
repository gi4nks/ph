import { spawnSync } from 'child_process';
import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { detectProject } from '../runner/project.js';
import { resolveRealBinary } from '../runner/inline.js';
import { getEmbeddings } from '../embedding/index.js';
import { formatProjectContext, getProjectContext } from '../context/index.js';

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
  const ollamaUrl = cfg.ollamaUrl ?? 'http://localhost:11434';
  const model = cfg.ollamaEmbedModel ?? 'nomic-embed-text-v2-moe';
  const context = await getProjectContext(db, { project, limit: 5, memoryLimit: 3 }, async (query) => {
    const [vector] = await getEmbeddings([query], ollamaUrl, model, 1);
    return vector;
  });

  db.close();

  const contextStr = formatProjectContext(context);
  const fullPrompt = `Context from project "${project}":\n\n${contextStr}\n\n---\n\n${userPrompt}`;

  const realBin = resolveRealBinary(tool);
  const child = spawnSync(realBin, [fullPrompt], { stdio: 'inherit', cwd: process.cwd() });
  process.exit(child.status ?? 0);
}
