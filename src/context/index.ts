import type { MemoryEntry, ProjectSummary, PromptEntry, PromptMetadata } from '../types.js';

export interface ProjectContextStore {
  getProjectSummary(project: string): ProjectSummary | null;
  searchMemories(project: string, limit?: number): MemoryEntry[];
  getProjectMemory(project: string, limit?: number): PromptEntry[];
  searchSemantic(queryVector: Float32Array, limit: number, project?: string): PromptEntry[];
}

export interface ProjectContextOptions {
  project: string;
  query?: string;
  limit?: number;
  memoryLimit?: number;
  includeSummary?: boolean;
  includeMemories?: boolean;
  includePrompts?: boolean;
}

export interface ProjectContext {
  project: string;
  summary: ProjectSummary | null;
  memories: MemoryEntry[];
  prompts: PromptEntry[];
}

export type ContextEmbedder = (query: string) => Promise<Float32Array | undefined>;

/** Retrieve all project context evidence through one consumer-facing boundary. */
export async function getProjectContext(
  db: ProjectContextStore,
  options: ProjectContextOptions,
  embedQuery?: ContextEmbedder,
): Promise<ProjectContext> {
  const limit = Math.max(1, Math.floor(options.limit ?? 5));
  const memoryLimit = Math.max(1, Math.floor(options.memoryLimit ?? limit));
  const includeSummary = options.includeSummary ?? true;
  const includeMemories = options.includeMemories ?? true;
  const includePrompts = options.includePrompts ?? true;

  const summary = includeSummary ? db.getProjectSummary(options.project) : null;
  const memories = includeMemories ? db.searchMemories(options.project, memoryLimit) : [];
  let prompts: PromptEntry[] = [];

  if (includePrompts) {
    const query = options.query?.trim();
    if (query) {
      if (!embedQuery) throw new Error('Semantic context requires an embedding provider.');
      const vector = await embedQuery(query);
      prompts = vector ? db.searchSemantic(vector, limit, options.project) : [];
    } else {
      prompts = db.getProjectMemory(options.project, limit);
    }
  }

  return { project: options.project, summary, memories, prompts };
}

export interface FormatProjectContextOptions {
  includePromptText?: boolean;
  promptExcerptLength?: number;
  responseExcerptLength?: number;
  emptyMessage?: string;
}

/** Render retrieved evidence as stable Markdown for terminal and agent consumers. */
export function formatProjectContext(
  context: ProjectContext,
  options: FormatProjectContextOptions = {},
): string {
  const parts: string[] = [];
  const { summary, memories, prompts, project } = context;

  if (summary || memories.length > 0) {
    parts.push(`## Project Knowledge: ${project}\n`);
    if (summary?.summary) parts.push(`${summary.summary}\n`);
    if (summary?.key_insights.length) {
      parts.push('Key Insights:');
      for (const insight of summary.key_insights) parts.push(`  - ${insight}`);
      parts.push('');
    }
    if (summary?.technical_decisions.length) {
      parts.push('Technical Decisions:');
      for (const decision of summary.technical_decisions) parts.push(`  - ${decision}`);
      parts.push('');
    }
    if (!summary && memories.length > 0) {
      for (const memory of memories) {
        parts.push(`### Memory #${memory.id}`);
        if (memory.summary) parts.push(`${memory.summary}\n`);
        if (memory.key_insights.length) {
          parts.push('Key Insights:');
          for (const insight of memory.key_insights) parts.push(`  - ${insight}`);
          parts.push('');
        }
        if (memory.technical_decisions.length) {
          parts.push('Technical Decisions:');
          for (const decision of memory.technical_decisions) parts.push(`  - ${decision}`);
          parts.push('');
        }
      }
    }
    if (summary && memories.length > 0) {
      parts.push('Recent Memory Entries:');
      for (const memory of memories) {
        if (memory.summary) parts.push(`  - [memory #${memory.id}] ${memory.summary}`);
      }
      parts.push('');
    }
  }

  if (prompts.length > 0) {
    if (parts.length > 0) parts.push('---\n');
    parts.push('## Recent Context\n');
    for (const entry of prompts) {
      let metadata: PromptMetadata = {};
      try { metadata = JSON.parse(entry.metadata) as PromptMetadata; } catch {}
      parts.push(`### Interaction #${entry.id} — ${entry.tool} (${new Date(entry.timestamp).toLocaleDateString()})`);
      if (metadata.role) parts.push(`Role: ${metadata.role}`);
      const promptSummary = metadata.summary || (
        options.includePromptText || options.promptExcerptLength
          ? ''
          : entry.prompt.slice(0, 100).replace(/\n/g, ' ')
      );
      if (promptSummary) parts.push(promptSummary);
      if (metadata.key_insights?.length) {
        for (const insight of metadata.key_insights) parts.push(`  - ${insight}`);
      }
      if (options.includePromptText) {
        parts.push('```\n' + entry.prompt.slice(0, 1000) + (entry.prompt.length > 1000 ? '\n...' : '') + '\n```');
      } else if (options.promptExcerptLength) {
        const excerpt = entry.prompt.slice(0, options.promptExcerptLength);
        parts.push(`Prompt: ${excerpt}${entry.prompt.length > options.promptExcerptLength ? '...' : ''}`);
      }
      if (options.responseExcerptLength && entry.response) {
        const response = entry.response.slice(0, options.responseExcerptLength);
        parts.push(`Response: ${response}${entry.response.length > options.responseExcerptLength ? '...' : ''}`);
      }
      parts.push('');
    }
  }

  if (parts.length === 0) return options.emptyMessage ?? `No relevant context found for project "${project}".`;
  return parts.join('\n').trimEnd();
}
