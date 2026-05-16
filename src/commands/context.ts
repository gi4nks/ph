import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import type { PromptEntry, PromptMetadata } from '../types.js';
import { getEmbeddings } from '../embedding/index.js';
import { detectProject } from '../runner/project.js';
import { parseFlags } from './_utils.js';

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

  const memories = !promptsOnly ? db.searchMemories(project, limit) : [];

  let prompts: PromptEntry[] = [];
  if (!memoriesOnly) {
    if (query) {
      const ollamaUrl = cfg.ollamaUrl ?? 'http://localhost:11434';
      const model = cfg.ollamaEmbedModel ?? 'nomic-embed-text-v2-moe';
      const [queryVec] = await getEmbeddings([query], ollamaUrl, model, 1);
      if (queryVec) {
        const semResults = db.searchSemantic(queryVec, limit * 3);
        prompts = semResults.filter(e => {
          try {
            const meta = JSON.parse(e.metadata) as PromptMetadata;
            return meta.project === project;
          } catch { return false; }
        }).slice(0, limit);
      }
    } else {
      prompts = db.getProjectMemory(project, limit);
    }
  }

  if (memories.length === 0 && prompts.length === 0) {
    process.stdout.write(`No relevant context found for project "${project}".\n`);
    return;
  }

  // Build markdown output
  const output: string[] = [];

  if (memories.length > 0) {
    output.push(`## Project Knowledge: ${project}\n`);
    for (const mem of memories) {
      if (mem.summary) output.push(`${mem.summary}\n`);
      if (mem.key_insights.length > 0) {
        output.push('Key Insights:');
        for (const insight of mem.key_insights) output.push(`  - ${insight}`);
        output.push('');
      }
      if (mem.technical_decisions.length > 0) {
        output.push('Technical Decisions:');
        for (const dec of mem.technical_decisions) output.push(`  - ${dec}`);
        output.push('');
      }
    }
  }

  if (prompts.length > 0) {
    output.push('---\n');
    output.push(`## Recent Context\n`);
    for (const e of prompts) {
      let meta: PromptMetadata = {};
      try { meta = JSON.parse(e.metadata); } catch {}

      output.push(`### #${e.id}`);
      if (meta.role) output.push(`Role: ${meta.role}`);
      if (meta.summary) output.push(`${meta.summary}`);
      if (meta.key_insights && meta.key_insights.length > 0) {
        for (const i of meta.key_insights) output.push(`  - ${i}`);
      }
      if (verbose) {
        output.push('```\n' + e.prompt.slice(0, 1000) + (e.prompt.length > 1000 ? '\n...' : '') + '\n```');
      }
      output.push('');
    }
  }

  process.stdout.write(output.join('\n'));
}
