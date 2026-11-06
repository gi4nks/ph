import type { MemoryEntry, PromptEntry, PromptMetadata, SearchOptions } from '../types.js';
import type { SearchMemoriesOptions } from '../db/memory-repository.js';
import type { PhConfig } from '../config/index.js';
import { getEmbeddings } from '../embedding/index.js';
import { reciprocalRankFusion } from '../db/fts.js';

export const DEFAULT_EMBED_MODEL = 'nomic-embed-text-v2-moe';

export interface ProjectContextStore {
  searchMemories(options: SearchMemoriesOptions): MemoryEntry[];
  search(options: SearchOptions & { anyTerms?: boolean }): PromptEntry[];
  getRecentProjectPrompts(project: string, limit: number): PromptEntry[];
  getEmbeddingCount(): number;
  searchSemantic(queryVector: Float32Array, limit: number, project?: string, model?: string): PromptEntry[];
}

export interface ProjectContextOptions {
  project: string;
  query?: string;
  limit?: number;
  memoryLimit?: number;
  includeMemories?: boolean;
  includePrompts?: boolean;
}

export interface ProjectContext {
  project: string;
  memories: MemoryEntry[];
  prompts: PromptEntry[];
  /** Retrieval notes, e.g. which signals were used or why semantic search was skipped. */
  notes: string[];
}

export type ContextEmbedder = (query: string) => Promise<Float32Array | undefined>;

export interface ContextRetrievalOptions {
  embed?: ContextEmbedder;
  embedModel?: string;
}

/**
 * Retrieve project evidence through one boundary shared by the CLI and MCP.
 * With a query: project + work memories via FTS5, prompts via FTS5 fused with
 * sqlite-vec nearest neighbours when vectors exist. Without a query: the most
 * recent memories and interactions. Never requires an embedding service.
 */
export async function getProjectContext(
  db: ProjectContextStore,
  options: ProjectContextOptions,
  retrieval: ContextRetrievalOptions = {},
): Promise<ProjectContext> {
  const limit = Math.max(1, Math.floor(options.limit ?? 5));
  const memoryLimit = Math.max(1, Math.floor(options.memoryLimit ?? limit));
  const includeMemories = options.includeMemories ?? true;
  const includePrompts = options.includePrompts ?? true;
  const query = options.query?.trim() || undefined;
  const notes: string[] = [];

  let memories: MemoryEntry[] = [];
  if (includeMemories) {
    const projectMemories = db.searchMemories({ query, project: options.project, limit: memoryLimit });
    const workMemories = db.searchMemories({ query, scope: 'work', limit: memoryLimit });
    const seen = new Set<number>();
    memories = [...projectMemories, ...workMemories].filter(memory => {
      if (seen.has(memory.id)) return false;
      seen.add(memory.id);
      return true;
    }).slice(0, memoryLimit);
  }

  let prompts: PromptEntry[] = [];
  if (includePrompts) {
    if (!query) {
      prompts = db.getRecentProjectPrompts(options.project, limit);
    } else {
      const candidates = limit * 3;
      const textMatches = db.search({ query, project: options.project, limit: candidates, anyTerms: true });
      let semanticMatches: PromptEntry[] = [];

      if (db.getEmbeddingCount() === 0) {
        notes.push('semantic index is empty (run `ph embed-all` to enable it); used text search');
      } else if (!retrieval.embed) {
        notes.push('no embedding provider configured; used text search');
      } else {
        try {
          const vector = await retrieval.embed(query);
          if (vector?.length) {
            semanticMatches = db.searchSemantic(vector, candidates, options.project, retrieval.embedModel);
          } else {
            notes.push('embedding provider returned no vector; used text search');
          }
        } catch (error) {
          notes.push(`semantic search unavailable (${(error as Error).message}); used text search`);
        }
      }

      const byId = new Map<number, PromptEntry>();
      for (const entry of [...textMatches, ...semanticMatches]) byId.set(entry.id, entry);
      const fused = reciprocalRankFusion([textMatches.map(entry => entry.id), semanticMatches.map(entry => entry.id)]);
      prompts = fused.slice(0, limit).map(id => byId.get(id)!).filter(Boolean);

      if (prompts.length === 0) {
        prompts = db.getRecentProjectPrompts(options.project, limit);
        if (prompts.length > 0) notes.push('no matching interactions; showing the most recent project work');
      }
    }
  }

  return { project: options.project, memories, prompts, notes };
}

/** Build an Ollama-backed embedder from configuration. */
export function configuredEmbedder(cfg: Pick<PhConfig, 'ollamaUrl' | 'ollamaEmbedModel'>): Required<ContextRetrievalOptions> {
  const embedModel = cfg.ollamaEmbedModel ?? DEFAULT_EMBED_MODEL;
  return {
    embedModel,
    embed: async (query: string) => {
      const [vector] = await getEmbeddings([query], cfg.ollamaUrl ?? 'http://localhost:11434', embedModel, 1);
      return vector;
    },
  };
}

export interface FormatProjectContextOptions {
  includePromptText?: boolean;
  promptExcerptLength?: number;
  responseExcerptLength?: number;
  emptyMessage?: string;
  maxChars?: number;
}

function formatMemoryLine(memory: MemoryEntry): string {
  const sources = memory.prompt_ids?.length ? memory.prompt_ids.map(id => `#${id}`).join(', ') : 'none recorded';
  const scope = memory.scope === 'project' ? '' : ` · ${memory.scope}`;
  const [first, ...rest] = memory.content.split('\n');
  const continuation = rest.map(line => `    ${line}`).join('\n');
  return `- [memory #${memory.id} · ${memory.kind}${scope}; prompts ${sources}] ${first}${continuation ? `\n${continuation}` : ''}`;
}

/** Render retrieved evidence as stable Markdown for terminal and agent consumers. */
export function formatProjectContext(
  context: ProjectContext,
  options: FormatProjectContextOptions = {},
): string {
  const parts: string[] = [];
  const { memories, prompts, project } = context;

  if (memories.length > 0) {
    parts.push(`## Project Knowledge: ${project}\n`);
    for (const memory of memories) parts.push(formatMemoryLine(memory));
    parts.push('');
  }

  if (prompts.length > 0) {
    if (parts.length > 0) parts.push('---\n');
    parts.push('## Relevant Interactions\n');
    for (const entry of prompts) {
      let metadata: PromptMetadata = {};
      try { metadata = JSON.parse(entry.metadata) as PromptMetadata; } catch { /* tolerate malformed metadata */ }
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
  const rendered = parts.join('\n').trimEnd();
  if (!options.maxChars || rendered.length <= options.maxChars) return rendered;

  const sources = new Set<string>();
  for (const memory of memories) {
    if (memory.prompt_ids.length) sources.add(`memory #${memory.id} ← prompts ${memory.prompt_ids.map(id => `#${id}`).join(', ')}`);
    else sources.add(`memory #${memory.id} (no prompt source recorded)`);
  }
  for (const prompt of prompts) sources.add(`prompt #${prompt.id} (${prompt.tool}, ${prompt.timestamp})`);
  const sourceBlock = `\n\nSources:\n${[...sources].map(source => `- ${source}`).join('\n')}`;
  const budget = Math.max(0, options.maxChars - sourceBlock.length - 40);
  const prefix = rendered.slice(0, budget).trimEnd();
  return `${prefix}${prefix ? '\n\n' : ''}[Context truncated; source references are preserved]${sourceBlock}`;
}
