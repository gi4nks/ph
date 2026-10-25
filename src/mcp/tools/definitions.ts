export const MCP_TOOL_DEFINITIONS = [
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
              promptIds: {
                type: "array",
                items: { type: "number" },
                description: "Optional source prompt IDs; every prompt must belong to project",
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
        {
          name: "search_shared_memory",
          description: "Search the central PH memory hub for non-sensitive work or project memories. Sensitive and personal-scope memories are never returned by this coding-agent tool.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Task, decision, or preference to recall" },
              scope: { type: "string", enum: ["work", "project"], description: "Memory scope; defaults to project" },
              limit: { type: "number", description: "Maximum records (1–20; default 5)", default: 5 },
            },
            required: ["query"],
          },
        },
        {
          name: "save_shared_memory",
          description: "Automatically save durable, non-sensitive work preferences and project decisions when they will help future tasks. Cite the originating PH prompt or session in source_ref. Never save health, finance, relationship, address, credential, or other sensitive personal data with this tool; that requires the user's explicit ph memory save --sensitive command.",
          inputSchema: {
            type: "object",
            properties: {
              content: { type: "string", description: "One concise durable memory, not transient task state" },
              scope: { type: "string", enum: ["work", "project"], description: "Memory scope" },
              kind: { type: "string", description: "For example preference, decision, or procedure" },
              source_ref: { type: "string", description: "Originating PH prompt ID or session reference" },
            },
            required: ["content", "scope", "kind", "source_ref"],
          },
        },
      ];
