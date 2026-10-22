import type { PhDB } from '../../db/index.js';
import type { PhConfig } from '../../config/index.js';
import { z } from 'zod';
import type { PromptMetadata } from '../../types.js';
import { getEmbeddings } from '../../embedding/index.js';
import { formatPromptList, formatSinglePrompt } from './format.js';

export async function handlePromptTool(name: string, args: unknown, db: PhDB, cfg: PhConfig) {
      if (name === "list_prompts") {
        const { project, page = 1, pageSize = 20 } = z.object({
          project: z.string(),
          page: z.number().optional(),
          pageSize: z.number().max(100).optional(),
        }).parse(args);

        const result = db.getPromptsByProjectPaginated(project, page, pageSize);
        const totalPages = Math.ceil(result.total / pageSize);

        const text = [
          `## Prompts for "${project}"`,
          `Page ${page}/${totalPages} (${result.total} total)\n`,
          ...result.entries.map(e => {
            let meta: PromptMetadata = {};
            try { meta = JSON.parse(e.metadata); } catch {}
            const date = new Date(e.timestamp).toLocaleString();
            const title = meta.title ? ` — ${meta.title}` : '';
            const roleStr = meta.role ? ` (${meta.role})` : '';
            return `### #${e.id} — ${e.tool}${roleStr} (${date})${title}\n${(meta.summary ? `Summary: ${meta.summary}\n` : '')}Prompt: ${e.prompt.slice(0, 200)}${e.prompt.length > 200 ? '...' : ''}`;
          }).join('\n\n'),
          '',
          `Page ${page}/${totalPages} | ${result.total} total prompts`,
        ].join('\n');

        return { content: [{ type: "text", text }] };
      }

      if (name === "search_prompts") {
        const { query, tool, project, role, tag, since, until, limit = 10 } = z.object({
          query: z.string().optional(),
          tool: z.string().optional(),
          project: z.string().optional(),
          role: z.string().optional(),
          tag: z.string().optional(),
          since: z.string().optional(),
          until: z.string().optional(),
          limit: z.number().optional(),
        }).parse(args);

        const results = db.search({
          query,
          tool,
          project,
          role,
          tag,
          ...(since ? { since: new Date(since) } : {}),
          ...(until ? { until: new Date(until) } : {}),
          limit,
        });

        return {
          content: [{ type: "text", text: formatPromptList(results, query) }],
        };
      }

      if (name === "get_prompt") {
        const { id } = z.object({
          id: z.number(),
        }).parse(args);

        const entry = db.getById(id);
        if (!entry) {
          return {
            content: [{ type: "text", text: `Prompt #${id} not found.` }],
          };
        }

        return {
          content: [{ type: "text", text: formatSinglePrompt(entry) }],
        };
      }

      if (name === "search_prompts_semantic") {
        const { query, project, limit = 5 } = z.object({
          query: z.string(),
          project: z.string().optional(),
          limit: z.number().optional(),
        }).parse(args);

        const ollamaUrl = cfg.ollamaUrl ?? 'http://localhost:11434';
        const model = cfg.ollamaEmbedModel ?? 'nomic-embed-text-v2-moe';

        const [queryVec] = await getEmbeddings([query], ollamaUrl, model, 1);
        if (!queryVec) {
          throw new Error("Failed to generate embedding for query");
        }

        const filtered = db.searchSemantic(queryVec, limit, project);

        return {
          content: [{ type: "text", text: formatPromptList(filtered, query) }],
        };
      }
  return undefined;
}
