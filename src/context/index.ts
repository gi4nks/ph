import type { MemoryEntry, PromptEntry, PromptMetadata, SearchOptions } from '../types.js';
import type { SearchMemoriesOptions } from '../db/memory-repository.js';
import type { PhConfig } from '../config/index.js';
import { DEFAULT_EMBED_MODEL, resolveOllamaUrl } from '../config/defaults.js';
import { getEmbeddings } from '../embedding/index.js';
import { reciprocalRankFusion } from '../db/fts.js';

export { DEFAULT_EMBED_MODEL };

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
      const [vector] = await getEmbeddings([query], resolveOllamaUrl(cfg), embedModel, 1, 10_000);
      return vector;
    },
  };
}

export interface FormatProjectContextOptions {
  includePromptText?: boolean;
  full?: boolean;
  promptExcerptLength?: number;
  responseExcerptLength?: number;
  emptyMessage?: string;
  maxChars?: number;
}

export type SharedMemoryInput = MemoryEntry | Record<string, unknown>;

export interface FormatCombinedContextOptions extends FormatProjectContextOptions {
  header?: string;
}

function formatMemoryLine(memory: MemoryEntry): string {
  const sources = memory.prompt_ids?.length ? memory.prompt_ids.map(id => `#${id}`).join(', ') : 'none recorded';
  const scope = memory.scope === 'project' ? '' : ` · ${memory.scope}`;
  const [first, ...rest] = memory.content.split('\n');
  const continuation = rest.map(line => `    ${line}`).join('\n');
  return `- [memory #${memory.id} · ${memory.kind}${scope}; prompts ${sources}] ${first}${continuation ? `\n${continuation}` : ''}`;
}

function formatSharedMemoryLine(memory: SharedMemoryInput): string {
  const kind = String(memory.kind ?? 'fact');
  const scope = String(memory.scope ?? 'work');
  const project = typeof memory.project === 'string' && memory.project ? `:${memory.project}` : '';
  let source = 'unspecified';
  if (memory.source_ref) {
    source = String(memory.source_ref);
  } else if (Array.isArray(memory.prompt_ids) && memory.prompt_ids.length) {
    source = `prompts ${memory.prompt_ids.map(id => `#${id}`).join(', ')}`;
  } else if (memory.source) {
    source = String(memory.source);
  }
  const [first, ...rest] = String(memory.content ?? '').split('\n');
  const continuation = rest.map(line => `    ${line}`).join('\n');
  return `- [${kind} · ${scope}${project}; source ${source}] ${first}${continuation ? `\n${continuation}` : ''}`;
}

function formatPromptBlock(entry: PromptEntry, options: FormatProjectContextOptions): string {
  const lines: string[] = [];
  let metadata: PromptMetadata = {};
  try { metadata = JSON.parse(entry.metadata) as PromptMetadata; } catch { /* tolerate malformed metadata */ }
  lines.push(`### Interaction #${entry.id} — ${entry.tool} (${new Date(entry.timestamp).toLocaleDateString()})`);
  if (metadata.role) lines.push(`Role: ${metadata.role}`);
  const includePromptText = Boolean(options.full || options.includePromptText);
  const promptSummary = metadata.summary || (
    includePromptText || options.promptExcerptLength
      ? ''
      : entry.prompt.slice(0, 100).replace(/\n/g, ' ')
  );
  if (promptSummary) lines.push(promptSummary);
  if (metadata.key_insights?.length) {
    for (const insight of metadata.key_insights) lines.push(`  - ${insight}`);
  }
  if (includePromptText) {
    lines.push('```\n' + entry.prompt.slice(0, 1000) + (entry.prompt.length > 1000 ? '\n...' : '') + '\n```');
  } else if (options.promptExcerptLength) {
    const excerpt = entry.prompt.slice(0, options.promptExcerptLength);
    lines.push(`Prompt: ${excerpt}${entry.prompt.length > options.promptExcerptLength ? '...' : ''}`);
  }
  if (options.responseExcerptLength && entry.response) {
    const response = entry.response.slice(0, options.responseExcerptLength);
    lines.push(`Response: ${response}${entry.response.length > options.responseExcerptLength ? '...' : ''}`);
  }
  return lines.join('\n');
}

function truncateText(text: string, maxLen: number): string {
  if (maxLen <= 0) return '';
  if (text.length <= maxLen) return text;
  if (maxLen <= 3) return text.slice(0, maxLen);
  return `${text.slice(0, maxLen - 3).trimEnd()}...`;
}

function packSection(heading: string, items: string[], headingSep: string, itemSep: string, budget: number): string {
  if (items.length === 0 || budget < heading.length + headingSep.length + 12) return '';
  let out = heading;
  for (let i = 0; i < items.length; i++) {
    const sep = i === 0 ? headingSep : itemSep;
    const candidate = `${out}${sep}${items[i]}`;
    if (candidate.length <= budget) {
      out = candidate;
      continue;
    }
    const avail = budget - out.length - sep.length;
    if (avail >= 30) {
      out = `${out}${sep}${truncateText(items[i], avail)}`;
    }
    break;
  }
  return out === heading ? '' : out;
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
      parts.push(formatPromptBlock(entry, options));
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

/**
 * Render shared memories, local project knowledge, and relevant interactions
 * under a single unified `maxChars` ceiling.
 */
export function formatCombinedContext(
  context: ProjectContext,
  sharedMemories: readonly SharedMemoryInput[],
  options: FormatCombinedContextOptions = {},
): string {
  const headerBlock = options.header?.trimEnd() ?? '';
  const limit = options.maxChars !== undefined ? Math.max(0, Math.floor(options.maxChars)) : undefined;

  if (sharedMemories.length === 0 && context.memories.length === 0 && context.prompts.length === 0) {
    const empty = options.emptyMessage ?? `No relevant context found for project "${context.project}".`;
    const combined = headerBlock ? `${headerBlock}\n\n${empty}` : empty;
    return limit !== undefined ? truncateText(combined, limit) : combined;
  }

  const sharedItems = sharedMemories.map(formatSharedMemoryLine);
  const localMemItems = context.memories.map(formatMemoryLine);
  const promptItems = context.prompts.map(entry => formatPromptBlock(entry, options));

  const sharedFull = sharedItems.length ? `## Shared PH Memory\n\n${sharedItems.join('\n')}` : '';
  const localMemFull = localMemItems.length ? `## Project Knowledge: ${context.project}\n\n${localMemItems.join('\n')}` : '';
  const promptsFull = promptItems.length ? `## Relevant Interactions\n\n${promptItems.join('\n\n')}` : '';

  const unbudgetedBody: string[] = [sharedFull, localMemFull].filter(Boolean);
  if (promptsFull) {
    if (unbudgetedBody.length > 0) unbudgetedBody.push('---');
    unbudgetedBody.push(promptsFull);
  }
  const fullRendered = (headerBlock ? [headerBlock, ...unbudgetedBody] : unbudgetedBody).join('\n\n').trimEnd();
  if (limit === undefined || fullRendered.length <= limit) return fullRendered;

  if (headerBlock && headerBlock.length >= limit) {
    return truncateText(headerBlock, limit);
  }
  const remaining = headerBlock ? limit - headerBlock.length - 2 : limit;

  const hasShared = sharedItems.length > 0;
  const hasLocalMem = localMemItems.length > 0;
  const hasMem = hasShared || hasLocalMem;
  const hasPrompts = promptItems.length > 0;

  let memBudget = 0;
  if (hasMem && hasPrompts) {
    memBudget = Math.floor(Math.max(0, remaining - 7) * 0.45);
  } else if (hasMem) {
    memBudget = remaining;
  }

  let sharedSection = '';
  let localSection = '';
  if (hasShared && hasLocalMem) {
    const inner = Math.max(0, memBudget - 2);
    sharedSection = packSection('## Shared PH Memory', sharedItems, '\n\n', '\n', Math.floor(inner * 0.5));
    const localBudget = inner - (sharedSection ? sharedSection.length : 0);
    localSection = packSection(`## Project Knowledge: ${context.project}`, localMemItems, '\n\n', '\n', localBudget);
    if (!localSection && sharedSection) {
      sharedSection = packSection('## Shared PH Memory', sharedItems, '\n\n', '\n', memBudget);
    }
  } else if (hasShared) {
    sharedSection = packSection('## Shared PH Memory', sharedItems, '\n\n', '\n', memBudget);
  } else if (hasLocalMem) {
    localSection = packSection(`## Project Knowledge: ${context.project}`, localMemItems, '\n\n', '\n', memBudget);
  }

  const memSections = [sharedSection, localSection].filter(Boolean);
  const memUsed = memSections.length ? memSections.join('\n\n').length : 0;
  const sepBeforePrompts = memUsed > 0 ? 7 : 0;
  const promptBudget = Math.max(0, remaining - memUsed - sepBeforePrompts);
  const promptSection = hasPrompts
    ? packSection('## Relevant Interactions', promptItems, '\n\n', '\n\n', promptBudget)
    : '';

  const bodyParts: string[] = [...memSections];
  if (promptSection) {
    if (memSections.length > 0) bodyParts.push('---');
    bodyParts.push(promptSection);
  }
  const assembled = (headerBlock ? [headerBlock, ...bodyParts] : bodyParts).join('\n\n').trimEnd();
  return assembled.length > limit ? truncateText(assembled, limit) : assembled;
}
