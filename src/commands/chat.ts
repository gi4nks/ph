import { spawnSync } from 'child_process';
import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { detectProject } from '../runner/project.js';
import { resolveRealBinary } from '../runner/inline.js';
import type { PromptMetadata } from '../types.js';

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
  const memories = db.searchMemories(project, 3);
  const recentPrompts = db.getProjectMemory(project, 5);

  const contextParts: string[] = [];

  if (memories.length > 0) {
    contextParts.push(`## Project Knowledge: ${project}`);
    for (const mem of memories) {
      if (mem.summary) contextParts.push(`\n${mem.summary}`);
      if (mem.key_insights.length > 0) {
        contextParts.push('\nKey Insights:');
        for (const i of mem.key_insights) contextParts.push(`  - ${i}`);
      }
      if (mem.technical_decisions.length > 0) {
        contextParts.push('\nTechnical Decisions:');
        for (const d of mem.technical_decisions) contextParts.push(`  - ${d}`);
      }
    }
  }

  if (recentPrompts.length > 0) {
    contextParts.push(`\n---\n## Recent Context`);
    for (const p of recentPrompts) {
      let meta: PromptMetadata = {};
      try { meta = JSON.parse(p.metadata); } catch {}
      const summary = meta.summary || p.prompt.slice(0, 100).replace(/\n/g, ' ');
      contextParts.push(`\n- #${p.id}: ${summary}`);
    }
  }

  db.close();

  const contextStr = contextParts.join('\n');
  const fullPrompt = `Context from project "${project}":\n\n${contextStr}\n\n---\n\n${userPrompt}`;

  const realBin = resolveRealBinary(tool);
  const child = spawnSync(realBin, [fullPrompt], { stdio: 'inherit', cwd: process.cwd() });
  process.exit(child.status ?? 0);
}