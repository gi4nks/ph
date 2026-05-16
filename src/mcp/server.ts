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
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
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

        const memories = db.searchMemories(project, 3);
        const prompts = db.getProjectMemory(project, limit);
        const parts: string[] = [];

        if (memories.length > 0) {
          parts.push('## Project Knowledge\n');
          for (const mem of memories) {
            if (mem.summary) parts.push(`${mem.summary}\n`);
            if (mem.key_insights.length > 0) {
              parts.push('Key Insights:');
              for (const i of mem.key_insights) parts.push(`  - ${i}`);
              parts.push('');
            }
            if (mem.technical_decisions.length > 0) {
              parts.push('Technical Decisions:');
              for (const d of mem.technical_decisions) parts.push(`  - ${d}`);
              parts.push('');
            }
          }
        }

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

        const memories = db.searchMemories(project, 5);

        if (memories.length === 0) {
          return {
            content: [{ type: "text", text: `No accumulated knowledge for project "${project}". Run "ph analyze" to generate insights.` }],
          };
        }

        const parts: string[] = [];
        for (const mem of memories) {
          parts.push(`## ${mem.summary || 'Project Memory'}\n`);
          if (mem.key_insights.length > 0) {
            parts.push('**Key Insights:**');
            for (const i of mem.key_insights) parts.push(`- ${i}`);
            parts.push('');
          }
          if (mem.technical_decisions.length > 0) {
            parts.push('**Technical Decisions:**');
            for (const d of mem.technical_decisions) parts.push(`- ${d}`);
            parts.push('');
          }
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

function formatResultsAsMarkdown(entries: any[]): string {
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
