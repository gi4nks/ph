import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PhDB, defaultPath } from "../db/index.js";
import { load as loadConfig } from "../config/index.js";
import type { PhConfig } from "../config/index.js";
import { MCP_TOOL_DEFINITIONS } from "./tools/definitions.js";
import { formatInteractionMarkdown } from "../interaction/detail.js";
import { configuredEmbedder, formatProjectContext } from "../context/index.js";
import type { MemoryKind, MemoryScope } from "../types.js";
import { MemoryService } from '../memory/service.js';

export function createMCPServer(db: PhDB, cfg: PhConfig = loadConfig()) {
  const memoryService = new MemoryService(db, cfg);
  const server = new Server(
    { name: "ph-memory", version: "2.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MCP_TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case "search_history": {
          const query = typeof args.query === 'string' ? args.query.trim() : undefined;
          const project = typeof args.project === 'string' ? args.project.trim() : undefined;
          const tool = typeof args.tool === 'string' ? args.tool.trim() : undefined;
          const since = typeof args.since === 'string' ? new Date(args.since) : undefined;
          const until = typeof args.until === 'string' ? new Date(args.until) : undefined;
          const limit = Math.max(1, Math.min(Number(args.limit) || 10, 50));

          const entries = db.search({ query, project, tool, since, until, limit });
          if (entries.length === 0) {
            return { content: [{ type: "text", text: "No matching interactions found." }] };
          }

          const lines = entries.map(e => {
            let meta: { project?: string; role?: string; summary?: string } = {};
            try { meta = JSON.parse(e.metadata); } catch {}
            const prj = meta.project ? ` [${meta.project}]` : '';
            const role = meta.role ? ` (${meta.role})` : '';
            const summary = meta.summary ? `\n  Summary: ${meta.summary}` : '';
            const promptSnippet = e.prompt.slice(0, 150).replace(/\n/g, ' ');
            return `#${e.id} [${e.tool}]${prj}${role} ${e.timestamp.slice(0, 10)}\n  Prompt: ${promptSnippet}${summary}`;
          });

          return { content: [{ type: "text", text: lines.join('\n\n') }] };
        }

        case "get_interaction": {
          const id = Number(args.id);
          if (!Number.isInteger(id) || id < 1) {
            throw new Error("A positive integer 'id' is required.");
          }
          const entry = db.getById(id);
          if (!entry) {
            return {
              isError: true,
              content: [{ type: "text", text: `Interaction #${id} not found.` }],
            };
          }
          return { content: [{ type: "text", text: formatInteractionMarkdown(entry) }] };
        }

        case "get_project_context": {
          const project = typeof args.project === 'string' ? args.project.trim() : '';
          if (!project) throw new Error("A 'project' name is required.");
          const task = typeof args.task === 'string' ? args.task.trim() : undefined;
          const limit = Math.max(1, Math.min(Number(args.limit) || 5, 20));

          const { context, shared: sharedMemories } = await memoryService.projectContext({
            project,
            query: task,
            limit,
          }, configuredEmbedder(cfg));

          const contextText = formatProjectContext(context, {
            promptExcerptLength: 300,
            responseExcerptLength: 300,
            maxChars: 4000,
          });
          const rendered = context.notes.length
            ? `Retrieval: ${context.notes.join('; ')}\n\n${contextText}`
            : contextText;
          const shared = sharedMemories.length
            ? `## Shared PH Memory\n\n${sharedMemories.map(formatSharedMemory).join('\n\n')}`
            : '';

          return { content: [{ type: "text", text: [shared, rendered].filter(Boolean).join('\n\n') }] };
        }

        case "search_memories": {
          const query = typeof args.query === 'string' ? args.query.trim() : undefined;
          const project = typeof args.project === 'string' ? args.project.trim() : undefined;
          const scope = args.scope === 'project' || args.scope === 'work' ? args.scope as MemoryScope : undefined;
          const limit = Math.max(1, Math.min(Number(args.limit) || 10, 50));

          const result = await memoryService.searchForAgent({
            query,
            project,
            scope,
            includePersonal: false,
            limit,
          });
          const memories = result.local;
          const shared = result.shared;

          if (memories.length === 0 && shared.length === 0) {
            return { content: [{ type: "text", text: "No memories found." }] };
          }

          const lines = memories.map(m => {
            const sources = m.prompt_ids.length ? ` (sources: ${m.prompt_ids.map(id => `#${id}`).join(', ')})` : '';
            const prj = m.project ? ` [${m.project}]` : '';
            return `#${m.id} [${m.kind} · ${m.scope}${prj}]${sources}\n${m.content}`;
          }).concat(shared.map(formatSharedMemory));

          return { content: [{ type: "text", text: lines.join('\n\n') }] };
        }

        case "save_memory": {
          const content = typeof args.content === 'string' ? args.content.trim() : '';
          if (!content) throw new Error("A non-empty 'content' string is required.");
          const rawScope = args.scope as string | undefined;
          const project = typeof args.project === 'string' ? args.project.trim() : undefined;
          const scope: MemoryScope = rawScope === 'work' ? 'work' : 'project';
          if (scope === 'project' && !project) {
            throw new Error("Project name is required when scope is 'project'.");
          }
          const kind: MemoryKind = (args.kind as MemoryKind) ?? 'decision';
          const promptIds = Array.isArray(args.promptIds)
            ? args.promptIds.filter((id): id is number => Number.isInteger(id) && id > 0)
            : undefined;

          const saved = await memoryService.save({ content, scope, project, kind, prompt_ids: promptIds, source: 'mcp-coding-agent' });
          if (saved.source === 'hub') {
            return { content: [{ type: "text", text: `Saved shared memory ${saved.id} [${kind} · ${scope}${project ? `:${project}` : ''}].` }] };
          }

          return {
            content: [{
              type: "text",
              text: `Saved memory #${saved.memory.id} [${saved.memory.kind} · ${saved.memory.scope}${saved.memory.project ? `:${saved.memory.project}` : ''}].`,
            }],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
      };
    }
  });

  return server;
}

function formatSharedMemory(memory: Record<string, unknown>): string {
  const scope = String(memory.scope ?? 'work');
  const project = typeof memory.project === 'string' && memory.project ? `:${memory.project}` : '';
  const source = typeof memory.source_ref === 'string' && memory.source_ref ? `; source: ${memory.source_ref}` : '';
  return `#${String(memory.id ?? 'shared')} [${String(memory.kind ?? 'fact')} · ${scope}${project}${source}]\n${String(memory.content ?? '')}`;
}

export async function runMCPServer() {
  const cfg = loadConfig();
  const dbPath = process.env.PH_DB ?? cfg.dbPath ?? defaultPath();
  const db = new PhDB(dbPath);
  const server = createMCPServer(db, cfg);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ph MCP server running on stdio");
}
