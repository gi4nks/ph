import type { PhDB } from '../../db/index.js';
import type { PhConfig } from '../../config/index.js';
import { z } from 'zod';
import type { PromptMetadata } from '../../types.js';
import { getEmbeddings } from '../../embedding/index.js';
import { formatProjectContext, getProjectContext } from '../../context/index.js';
import { formatResultsAsMarkdown } from './format.js';
import { promoteProjectKnowledge } from '../../knowledge/promotion.js';
import { retrieveTaskContext } from '../../knowledge/task-context.js';

export async function handleProjectTool(name: string, args: unknown, db: PhDB, cfg: PhConfig) {
      if (name === "save_decision") {
        const { project, summary, keyInsights, technicalDecisions, promptIds } = z.object({
          project: z.string(),
          summary: z.string(),
          keyInsights: z.array(z.string()).optional(),
          technicalDecisions: z.array(z.string()).optional(),
          promptIds: z.array(z.number().int().positive()).optional(),
        }).parse(args);

        const [id] = promoteProjectKnowledge(db, [{
          project,
          prompt_ids: [...new Set(promptIds ?? [])],
          summary,
          key_insights: keyInsights ?? [],
          technical_decisions: technicalDecisions ?? [],
        }]);

        return {
          content: [{ type: "text", text: `Decision saved as memory #${id} for project "${project}".\n\nSummary: ${summary}\nKey Insights: ${(keyInsights ?? []).length}\nTechnical Decisions: ${(technicalDecisions ?? []).length}` }],
        };
      }

      if (name === "get_project_diff") {
        const { project, since, until } = z.object({
          project: z.string(),
          since: z.string(),
          until: z.string().optional(),
        }).parse(args);

        const sinceDate = new Date(since);
        const untilDate = until ? new Date(until) : new Date();

        const prompts = db.search({
          project,
          since: sinceDate,
          until: untilDate,
          limit: 1000,
        });

        const memories = db.getAllMemoriesByProject(project)
          .filter(m => {
            const created = new Date(m.created_at);
            return created >= sinceDate && created <= untilDate;
          });

        const lines: string[] = [
          `## Project Diff: ${project}`,
          `From: ${since}  To: ${until || 'now'}`,
          `Prompts: ${prompts.length}  Memories: ${memories.length}\n`,
        ];

        if (prompts.length > 0) {
          lines.push('### Prompts\n');
          for (const p of prompts.reverse()) {
            let meta: PromptMetadata = {};
            try { meta = JSON.parse(p.metadata); } catch {}
            const title = meta.title ? ` — ${meta.title}` : '';
            const roleStr = meta.role ? ` (${meta.role})` : '';
            lines.push(`- **#${p.id}** ${p.tool}${roleStr}${title} (${new Date(p.timestamp).toLocaleDateString()})`);
            if (meta.summary) lines.push(`  Summary: ${meta.summary}`);
          }
        }

        if (memories.length > 0) {
          lines.push('\n### Memory Entries\n');
          for (const m of memories) {
            lines.push(`- **Memory #${m.id}**: ${m.summary}`);
            for (const i of m.key_insights) lines.push(`  - Insight: ${i}`);
            for (const d of m.technical_decisions) lines.push(`  - Decision: ${d}`);
          }
        }

        return { content: [{ type: "text", text: lines.join('\n') }] };
      }

      if (name === "search_project_memory") {
        const { query, project, limit = 5 } = z.object({
          query: z.string(),
          project: z.string(),
          limit: z.number().optional(),
        }).parse(args);

        const ollamaUrl = cfg.ollamaUrl ?? 'http://localhost:11434';
        const model = cfg.ollamaEmbedModel ?? 'nomic-embed-text-v2-moe';

        const [queryVec] = await getEmbeddings([query], ollamaUrl, model, 1);
        if (!queryVec) {
          throw new Error("Failed to generate embedding for query");
        }

        const filtered = db.searchSemantic(queryVec, limit, project);

        if (filtered.length === 0) {
          const merged = db.getProjectSummary(project);
          if (merged) {
            const parts: string[] = [
              `## Project Knowledge: ${project}\n`,
              `Based on ${merged.prompt_count} interactions.\n`,
            ];
            if (merged.summary) parts.push(`${merged.summary}\n`);
            if (merged.key_insights.length > 0) {
              parts.push('\n**Key Insights:**');
              for (const i of merged.key_insights) parts.push(`- ${i}`);
            }
            if (merged.technical_decisions.length > 0) {
              parts.push('\n**Technical Decisions:**');
              for (const d of merged.technical_decisions) parts.push(`- ${d}`);
            }
            return { content: [{ type: "text", text: parts.join('\n') }] };
          }
          return { content: [{ type: "text", text: `No relevant memory found for project "${project}".` }] };
        }

        return {
          content: [{ type: "text", text: formatResultsAsMarkdown(filtered) }],
        };
      }

      if (name === "get_project_context") {
        const { project, limit = 10 } = z.object({
          project: z.string(),
          limit: z.number().optional(),
        }).parse(args);

        const context = await getProjectContext(db, { project, limit, memoryLimit: 3 });

        return {
          content: [{ type: "text", text: formatProjectContext(context, {
            promptExcerptLength: 300,
            responseExcerptLength: 200,
            emptyMessage: 'No context found for this project.',
          }) }],
        };
      }

      if (name === "get_project_summary") {
        const { project } = z.object({
          project: z.string(),
        }).parse(args);

        const summary = db.getProjectSummary(project);

        if (!summary) {
          return {
            content: [{ type: "text", text: `No accumulated knowledge for project "${project}". Run "ph analyze" to generate insights.` }],
          };
        }

        const parts: string[] = [];
        parts.push(`## ${summary.summary || 'Project Memory'}\n`);
        parts.push(`Based on ${summary.prompt_count} interactions.\n`);
        if (summary.key_insights.length > 0) {
          parts.push('**Key Insights:**');
          for (const i of summary.key_insights) parts.push(`- ${i}`);
          parts.push('');
        }
        if (summary.technical_decisions.length > 0) {
          parts.push('**Technical Decisions:**');
          for (const d of summary.technical_decisions) parts.push(`- ${d}`);
          parts.push('');
        }

        return {
          content: [{ type: "text", text: parts.join('\n') }],
        };
      }

      if (name === "check_project_knowledge") {
        const { project, task, limit = 5 } = z.object({
          project: z.string(),
          task: z.string(),
          limit: z.number().optional(),
        }).parse(args);

        const { context, fallbackReason } = await retrieveTaskContext(db, cfg, project, task, limit);
        const warning = fallbackReason ? 'Semantic search unavailable; showing recent project context.' : '';
        const rendered = formatProjectContext(context, { promptExcerptLength: 400, responseExcerptLength: 250, emptyMessage: 'No existing knowledge found for this task. This appears to be new work.' });
        return {
          content: [{ type: "text", text: `# Knowledge Check: "${task}" in ${project}\n\n${warning ? `> ${warning}\n\n` : ''}${rendered}\n\n---\n**Recommendation**: Review related evidence before implementing; adapt prior work where it applies.` }],
        };
      }
  return undefined;
}
