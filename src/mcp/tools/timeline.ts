import type { PhDB } from '../../db/index.js';
import type { PhConfig } from '../../config/index.js';
import { z } from 'zod';
import type { PromptMetadata } from '../../types.js';

export async function handleTimelineTool(name: string, args: unknown, db: PhDB, _cfg: PhConfig) {
      if (name === "get_project_timeline") {
        const { project, since, until, limit = 100 } = z.object({
          project: z.string(),
          since: z.string().optional(),
          until: z.string().optional(),
          limit: z.number().optional(),
        }).parse(args);

        let allPrompts = db.getAllPromptsByProject(project);
        let memories = db.getAllMemoriesByProject(project);

        // Apply date filters
        if (since) {
          const sinceDate = new Date(since);
          allPrompts = allPrompts.filter(p => new Date(p.timestamp) >= sinceDate);
          memories = memories.filter(m => new Date(m.created_at) >= sinceDate);
        }
        if (until) {
          const untilDate = new Date(until);
          allPrompts = allPrompts.filter(p => new Date(p.timestamp) <= untilDate);
          memories = memories.filter(m => new Date(m.created_at) <= untilDate);
        }

        if (allPrompts.length === 0 && memories.length === 0) {
          return {
            content: [{ type: "text", text: `No history found for project "${project}"${since ? ` since ${since}` : ''}${until ? ` until ${until}` : ''}.` }],
          };
        }

        const events: Array<{ timestamp: string; text: string }> = [];

        for (const p of allPrompts.slice(0, limit)) {
          let meta: PromptMetadata = {};
          try { meta = JSON.parse(p.metadata); } catch {}
          events.push({
            timestamp: p.timestamp,
            text: [
              `### #${p.id} — ${p.tool}`,
              meta.role ? `Role: ${meta.role}` : '',
              meta.title ? `Title: ${meta.title}` : '',
              meta.tags?.length ? `Tags: ${meta.tags.join(', ')}` : '',
              meta.summary ? `Summary: ${meta.summary}` : '',
              `Prompt: ${p.prompt.slice(0, 500)}${p.prompt.length > 500 ? '...' : ''}`,
              p.response ? `Response: ${p.response.slice(0, 300)}${p.response.length > 300 ? '...' : ''}` : '',
              meta.key_insights?.length ? `Insights:\n${meta.key_insights.map(i => `- ${i}`).join('\n')}` : '',
            ].filter(Boolean).join('\n'),
          });
        }

        for (const m of memories) {
          events.push({
            timestamp: m.created_at,
            text: [
              `📌 Memory #${m.id}`,
              m.prompt_ids.length > 0 ? `From prompts: #${m.prompt_ids.join(', #')}` : '',
              m.summary ? `Summary: ${m.summary}` : '',
              m.key_insights.length > 0 ? `Key Insights:\n${m.key_insights.map(i => `- ${i}`).join('\n')}` : '',
              m.technical_decisions.length > 0 ? `Technical Decisions:\n${m.technical_decisions.map(d => `- ${d}`).join('\n')}` : '',
            ].filter(Boolean).join('\n'),
          });
        }

        events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        const range = since || until ? ` (${since || '…'} → ${until || 'now'})` : '';
        const header = `# Timeline: ${project}${range}\n\n${allPrompts.length} prompts · ${memories.length} memory entries\n\n`;
        const body = events.map(e => {
          const date = new Date(e.timestamp).toLocaleDateString('en-CA');
          const time = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return `## ${date} ${time}\n\n${e.text}\n`;
        }).join('---\n');

        return {
          content: [{ type: "text", text: header + body }],
        };
      }
  return undefined;
}
