import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PhDB, defaultPath } from "../db/index.js";
import { load as loadConfig } from "../config/index.js";
import type { PhConfig } from "../config/index.js";
import { MCP_TOOL_DEFINITIONS } from "./tools/definitions.js";
import { handlePromptTool } from "./tools/prompts.js";
import { handleProjectTool } from "./tools/projects.js";
import { handleTimelineTool } from "./tools/timeline.js";
import { handleSharedMemoryTool } from "./tools/shared-memory.js";

export function createMCPServer(db: PhDB, cfg: PhConfig = loadConfig()) {
  const server = new Server(
    { name: "ph-memory", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MCP_TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;
    try {
      const handlers = [handlePromptTool, handleProjectTool, handleTimelineTool];
      for (const handle of handlers) {
        const result = await handle(name, args, db, cfg);
        if (result) return result;
      }
      const sharedMemoryResult = await handleSharedMemoryTool(name, args, cfg);
      if (sharedMemoryResult) return sharedMemoryResult;
      throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
      };
    }
  });

  return server;
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
