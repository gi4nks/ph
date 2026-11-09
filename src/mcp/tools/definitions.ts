export const MCP_TOOL_DEFINITIONS = [
  {
    name: "search_history",
    description: "Search AI prompt and response history using full-text and semantic search. Returns matching interactions with IDs, timestamps, tools, and excerpts.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (text or keywords)" },
        project: { type: "string", description: "Filter by project name" },
        tool: { type: "string", description: "Filter by tool name (claude, codex, gemini, opencode, agy)" },
        since: { type: "string", description: "ISO date string — only prompts after this date" },
        until: { type: "string", description: "ISO date string — only prompts before this date" },
        limit: { type: "number", description: "Max results (default 10, max 50)", default: 10 },
      },
    },
  },
  {
    name: "get_interaction",
    description: "Get the complete detail of a single interaction by ID, including full prompt, response, tool, workdir, and analysis metadata.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The prompt/interaction ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_project_context",
    description: "Retrieve local and, when configured, shared non-sensitive knowledge plus relevant interactions for a project. If task is provided, retrieves task-relevant evidence.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "The project name" },
        task: { type: "string", description: "Optional description of the task being worked on" },
        limit: { type: "number", description: "Max interactions to retrieve (default 5)", default: 5 },
      },
      required: ["project"],
    },
  },
  {
    name: "search_memories",
    description: "Search local and configured shared project/work memories (decisions, insights, facts, preferences). Personal and sensitive memories are excluded.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        project: { type: "string", description: "Optional project name filter" },
        scope: { type: "string", enum: ["project", "work"], description: "Filter by scope" },
        limit: { type: "number", description: "Max results (default 10)", default: 10 },
      },
    },
  },
  {
    name: "save_memory",
    description: "Save a concise durable decision, architectural insight, or work preference locally or to the configured shared hub. Optional promptIds must exist and project-scoped sources must belong to the target project.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The memory content (concise, durable)" },
        scope: { type: "string", enum: ["project", "work"], description: "Memory scope (defaults to project if project is set, otherwise work)", default: "project" },
        project: { type: "string", description: "Project name (required for project scope)" },
        kind: { type: "string", enum: ["decision", "insight", "preference", "fact"], description: "Memory kind", default: "decision" },
        promptIds: {
          type: "array",
          items: { type: "number" },
          description: "Optional source prompt IDs from PH history",
        },
      },
      required: ["content"],
    },
  },
];
