import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { PhDB, defaultPath } from "../db/index.js";
import { load as loadConfig } from "../config/index.js";
import { getEmbeddings } from "../embedding/index.js";
import type { PromptEntry, PromptMetadata } from "../types.js";
import { z } from "zod";

export async function runMCPServer() {
  const cfg = loadConfig();
  const dbPath = process.env.PH_DB ?? cfg.dbPath ?? defaultPath();
  const db = new PhDB(dbPath);

  const server = new Server(
    {
      name: "ph-memory",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "list_prompts",
          description: "List prompts for a project with pagination. Use page=1, pageSize=10 to browse.",
          inputSchema: {
            type: "object",
            properties: {
              project: { type: "string", description: "Project name to list prompts for" },
              page: { type: "number", description: "Page number (1-based)", default: 1 },
              pageSize: { type: "number", description: "Results per page (max 100)", default: 20 },
            },
            required: ["project"],
          },
        },
        {
          name: "save_decision",
          description: "Save an architectural decision or key insight to project memory.",
          inputSchema: {
            type: "object",
            properties: {
              project: { type: "string", description: "Project name" },
              summary: { type: "string", description: "Brief summary of the decision" },
              keyInsights: {
                type: "array",
                items: { type: "string" },
                description: "Key insights or takeaways",
              },
              technicalDecisions: {
                type: "array",
                items: { type: "string" },
                description: "Technical decisions made",
              },
            },
            required: ["project", "summary"],
          },
        },
        {
          name: "get_project_diff",
          description: "Compare project state between two points in time. Shows prompts and memory entries created in the date range.",
          inputSchema: {
            type: "object",
            properties: {
              project: { type: "string", description: "Project name" },
              since: { type: "string", description: "Start date (ISO 8601, e.g. 2026-01-01)" },
              until: { type: "string", description: "End date (ISO 8601, defaults to now)" },
            },
            required: ["project", "since"],
          },
        },
        {
          name: "search_project_memory",
          description: "Search for past interactions and technical decisions in a specific project using semantic search.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "The search query (e.g. 'how did we handle auth?')" },
              project: { type: "string", description: "The project name to filter by" },
              limit: { type: "number", description: "Max results to return", default: 5 },
            },
            required: ["query", "project"],
          },
        },
        {
          name: "get_project_context",
          description: "Retrieve recent summaries, key insights, and technical decisions for a project.",
          inputSchema: {
            type: "object",
            properties: {
              project: { type: "string", description: "The project name" },
              limit: { type: "number", description: "Max interactions to retrieve", default: 10 },
            },
            required: ["project"],
          },
        },
        {
          name: "get_project_summary",
          description: "Get high-level accumulated project knowledge from memories: key insights and technical decisions.",
          inputSchema: {
            type: "object",
            properties: {
              project: { type: "string", description: "The project name" },
            },
            required: ["project"],
          },
        },
        {
          name: "search_prompts",
          description: "Search prompt history by text or filters. Omit query for recent prompts.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Full-text search query (searches prompt + response)" },
              tool: { type: "string", description: "Filter by tool name (e.g. claude, gemini)" },
              project: { type: "string", description: "Filter by project name" },
              role: { type: "string", description: "Filter by role (debug, refactor, explain, etc.)" },
              tag: { type: "string", description: "Filter by tag" },
              since: { type: "string", description: "ISO date string — only prompts after this date" },
              until: { type: "string", description: "ISO date string — only prompts before this date" },
              limit: { type: "number", description: "Max results (default 10)", default: 10 },
            },
          },
        },
        {
          name: "get_prompt",
          description: "Get full details of a single prompt by ID.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "number", description: "The prompt ID" },
            },
            required: ["id"],
          },
        },
        {
          name: "search_prompts_semantic",
          description: "Search prompt history by semantic similarity (vector search).",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Natural language query" },
              project: { type: "string", description: "Filter by project name" },
              limit: { type: "number", description: "Max results (default 5)", default: 5 },
            },
            required: ["query"],
          },
        },
        {
          name: "get_project_timeline",
          description: "Get full chronological timeline of a project: all prompts, analysis summaries, key insights, and technical decisions in sequence.",
          inputSchema: {
            type: "object",
            properties: {
              project: { type: "string", description: "The project name" },
              since: { type: "string", description: "Start date (ISO 8601, optional)" },
              until: { type: "string", description: "End date (ISO 8601, optional)" },
              limit: { type: "number", description: "Max events to return (default 100)", default: 100 },
            },
            required: ["project"],
          },
        },
        {
          name: "check_project_knowledge",
          description: "Before implementing a feature, check if it already exists in project history. Searches memories and prompts for previous implementations, discussions, and technical decisions related to a task.",
          inputSchema: {
            type: "object",
            properties: {
              project: { type: "string", description: "The project name" },
              task: { type: "string", description: "Description of the feature or task to check" },
              limit: { type: "number", description: "Max results per search (default 5)", default: 5 },
            },
            required: ["project", "task"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
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

      if (name === "save_decision") {
        const { project, summary, keyInsights, technicalDecisions } = z.object({
          project: z.string(),
          summary: z.string(),
          keyInsights: z.array(z.string()).optional(),
          technicalDecisions: z.array(z.string()).optional(),
        }).parse(args);

        const id = db.insertMemory({
          project,
          prompt_ids: [],
          summary,
          key_insights: keyInsights ?? [],
          technical_decisions: technicalDecisions ?? [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          access_count: 0,
        });

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

        const results = db.searchSemantic(queryVec, limit * 2);
        const filtered = results
          .filter(e => {
            try {
              const meta = JSON.parse(e.metadata) as PromptMetadata;
              return meta.project === project;
            } catch { return false; }
          })
          .slice(0, limit);

        return {
          content: [{ type: "text", text: formatResultsAsMarkdown(filtered) }],
        };
      }

      if (name === "get_project_context") {
        const { project, limit = 10 } = z.object({
          project: z.string(),
          limit: z.number().optional(),
        }).parse(args);

        const parts: string[] = [];

        // Start with merged project summary if available
        const merged = db.getProjectSummary(project);
        if (merged) {
          parts.push('## Project Knowledge (merged)\n');
          if (merged.summary) parts.push(`${merged.summary}\n`);
          if (merged.key_insights.length > 0) {
            parts.push('Key Insights:');
            for (const i of merged.key_insights) parts.push(`  - ${i}`);
            parts.push('');
          }
          if (merged.technical_decisions.length > 0) {
            parts.push('Technical Decisions:');
            for (const d of merged.technical_decisions) parts.push(`  - ${d}`);
            parts.push('');
          }
        }

        // Also pull recent memories (detailed entries)
        const memories = db.searchMemories(project, 3);
        if (memories.length > 0) {
          if (parts.length > 0) parts.push('---\n');
          parts.push('## Recent Memory Entries\n');
          for (const mem of memories) {
            if (mem.summary) parts.push(`- ${mem.summary}`);
          }
          parts.push('');
        }

        const prompts = db.getProjectMemory(project, limit);
        if (prompts.length > 0) {
          if (parts.length > 0) parts.push('---\n');
          parts.push('## Recent Interactions\n');
          parts.push(formatResultsAsMarkdown(prompts));
        }

        return {
          content: [{ type: "text", text: parts.join('\n') || 'No context found for this project.' }],
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

        const results = db.searchSemantic(queryVec, limit * 2);
        const filtered = project
          ? results.filter(e => {
              try {
                const meta = JSON.parse(e.metadata) as PromptMetadata;
                return meta.project === project;
              } catch { return false; }
            }).slice(0, limit)
          : results.slice(0, limit);

        return {
          content: [{ type: "text", text: formatPromptList(filtered, query) }],
        };
      }

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

      if (name === "check_project_knowledge") {
        const { project, task, limit = 5 } = z.object({
          project: z.string(),
          task: z.string(),
          limit: z.number().optional(),
        }).parse(args);

        const parts: string[] = [];
        parts.push(`# Knowledge Check: "${task}" in ${project}\n`);

        // 1. Search memories
        const memories = db.searchMemories(project, limit);
        const relevantMemories = memories.filter(m =>
          m.summary.toLowerCase().includes(task.toLowerCase()) ||
          m.key_insights.some(k => k.toLowerCase().includes(task.toLowerCase())) ||
          m.technical_decisions.some(d => d.toLowerCase().includes(task.toLowerCase()))
        );

        if (relevantMemories.length > 0) {
          parts.push(`## Found in Project Memories\n`);
          for (const m of relevantMemories) {
            parts.push(`### Memory #${m.id}`);
            if (m.summary) parts.push(`Summary: ${m.summary}`);
            if (m.key_insights.length > 0) {
              parts.push(`Key Insights:\n${m.key_insights.map(i => `- ${i}`).join('\n')}`);
            }
            if (m.technical_decisions.length > 0) {
              parts.push(`Technical Decisions:\n${m.technical_decisions.map(d => `- ${d}`).join('\n')}`);
            }
            parts.push('');
          }
        }

        // 2. Search prompts semantically
        const ollamaUrl = cfg.ollamaUrl ?? 'http://localhost:11434';
        const embedModel = cfg.ollamaEmbedModel ?? 'nomic-embed-text-v2-moe';

        try {
          const [queryVec] = await getEmbeddings([`${project}: ${task}`], ollamaUrl, embedModel, 1);
          if (queryVec) {
            const results = db.searchSemantic(queryVec, limit * 3);
            const projectPrompts = results.filter(e => {
              try {
                const meta = JSON.parse(e.metadata) as PromptMetadata;
                return meta.project === project;
              } catch { return false; }
            }).slice(0, limit);

            if (projectPrompts.length > 0) {
              parts.push(`## Related Prompts\n`);
              for (const p of projectPrompts) {
                let meta: PromptMetadata = {};
                try { meta = JSON.parse(p.metadata); } catch {}
                parts.push(`### #${p.id} — ${p.tool} (${new Date(p.timestamp).toLocaleDateString()})`);
                if (meta.role) parts.push(`Role: ${meta.role}`);
                if (meta.summary) parts.push(`Summary: ${meta.summary}`);
                parts.push(`Prompt: ${p.prompt.slice(0, 400)}${p.prompt.length > 400 ? '...' : ''}`);
                parts.push('');
              }
            }
          }
        } catch {
          parts.push('(Semantic search unavailable — Ollama may not be running)\n');
        }

        if (relevantMemories.length === 0 && !parts.some(p => p.startsWith('## Related Prompts'))) {
          parts.push('No existing knowledge found for this task. This appears to be new work.\n');
        }

        parts.push('---\n');
        parts.push('**Recommendation**: Review the above before implementing. If a previous implementation exists, consider reusing or adapting it.\n');

        return {
          content: [{ type: "text", text: parts.join('\n') }],
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ph MCP server running on stdio");
}

function formatResultsAsMarkdown(entries: PromptEntry[]): string {
  if (entries.length === 0) return "No relevant memory found for this project.";

  return entries.map(e => {
    let meta: PromptMetadata = {};
    try { meta = JSON.parse(e.metadata); } catch {}
    
    let out = `### Interaction #${e.id} (${new Date(e.timestamp).toLocaleDateString()})\n`;
    if (meta.role) out += `Role: ${meta.role}  \n`;
    if (meta.summary) out += `**Summary**: ${meta.summary}\n`;
    out += `**Prompt**: ${e.prompt.slice(0, 300)}${e.prompt.length > 300 ? '...' : ''}\n`;
    if (meta.key_insights && meta.key_insights.length > 0) {
      out += `**Key Insights**:\n${meta.key_insights.map(i => `- ${i}`).join('\n')}\n`;
    }
    return out;
  }).join('\n---\n\n');
}

function formatPromptList(entries: PromptEntry[], query?: string): string {
  if (entries.length === 0) return "No prompts found.";

  const header = query
    ? `Found ${entries.length} prompts matching "${query}":\n\n`
    : `Recent ${entries.length} prompts:\n\n`;

  return header + entries.map(e => {
    let meta: PromptMetadata = {};
    try { meta = JSON.parse(e.metadata); } catch {}

    const date = new Date(e.timestamp).toLocaleString();
    const proj = meta.project ? ` [${meta.project}]` : '';
    const title = meta.title ? ` — ${meta.title}` : '';
    const roleStr = meta.role ? `  \nRole: ${meta.role}` : '';

    let out = `### #${e.id} — ${e.tool}${proj} (${date})${title}\n`;
    if (meta.summary) out += `**Summary**: ${meta.summary}  \n`;
    out += `${roleStr}  \n`; // keep role placement consistent
    out += `**Prompt**: ${e.prompt.slice(0, 300)}${e.prompt.length > 300 ? '...' : ''}\n`;
    if (e.response) {
      out += `**Response**: ${e.response.slice(0, 200)}${e.response.length > 200 ? '...' : ''}\n`;
    }
    return out;
  }).join('\n---\n\n');
}

function formatSinglePrompt(e: PromptEntry): string {
  let meta: PromptMetadata = {};
  try { meta = JSON.parse(e.metadata); } catch {}

  const date = new Date(e.timestamp).toLocaleString();
  const parts: string[] = [];

  parts.push(`# Prompt #${e.id}\n`);
  parts.push(`**Tool**: ${e.tool}  `);
  parts.push(`**Date**: ${date}  `);
  if (meta.project) parts.push(`**Project**: ${meta.project}  `);
  if (meta.role) parts.push(`**Role**: ${meta.role}  `);
  if (meta.title) parts.push(`**Title**: ${meta.title}  `);
  if (meta.tags?.length) parts.push(`**Tags**: ${meta.tags.join(', ')}  `);
  if (e.workdir) parts.push(`**Workdir**: ${e.workdir}  `);
  if (e.exit_code !== 0) parts.push(`**Exit Code**: ${e.exit_code}  `);
  parts.push('');

  if (meta.summary) {
    parts.push(`**Summary**: ${meta.summary}\n`);
  }

  parts.push('---\n');
  parts.push('**Prompt**:\n');
  parts.push('```\n' + e.prompt + '\n```\n');

  if (e.response) {
    parts.push('\n**Response**:\n');
    parts.push('```\n' + e.response + '\n```\n');
  }

  if (meta.key_insights?.length) {
    parts.push('\n**Key Insights**:\n');
    for (const i of meta.key_insights) parts.push(`- ${i}\n`);
  }

  return parts.join('\n');
}
