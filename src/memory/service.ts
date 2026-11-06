import { randomUUID } from 'node:crypto';
import type { PhConfig } from '../config/index.js';
import type { PhDB } from '../db/index.js';
import type { ProjectContext, ContextRetrievalOptions, ProjectContextOptions } from '../context/index.js';
import { getProjectContext } from '../context/index.js';
import type { MemoryEntry } from '../types.js';
import type { AddMemoryInput, SearchMemoriesOptions } from '../db/memory-repository.js';
import { resolveMemoryHubConfig } from '../config/runtime.js';
import { forgetHubMemory, getHubMemory, restoreHubMemory, saveHubMemory, searchHubMemories } from './hub-client.js';

export interface MemoryHubClient {
  save(cfg: PhConfig, input: Parameters<typeof saveHubMemory>[1]): Promise<string>;
  search(cfg: PhConfig, query: string, scope?: 'work' | 'project' | 'personal', limit?: number,
    includeSensitive?: boolean, includePersonal?: boolean, project?: string): Promise<Array<Record<string, unknown>>>;
  get(cfg: PhConfig, id: string): Promise<Record<string, unknown> | undefined>;
  forget(cfg: PhConfig, id: string): Promise<boolean>;
  restore(cfg: PhConfig, id: string): Promise<void>;
}

const defaultHubClient: MemoryHubClient = {
  save: saveHubMemory,
  search: searchHubMemories,
  get: getHubMemory,
  forget: forgetHubMemory,
  restore: restoreHubMemory,
};

export interface MemorySearchResult {
  source: 'local' | 'hub';
  local: MemoryEntry[];
  shared: Array<Record<string, unknown>>;
}

export interface MemoryContextResult {
  context: ProjectContext;
  shared: Array<Record<string, unknown>>;
}

/**
 * Owns the local-versus-hub memory policy for CLI, context, and MCP callers.
 * The hub remains an adapter: interaction IDs are validated against the
 * originating local history before they are attached to a shared memory.
 */
export class MemoryService {
  constructor(
    private readonly db: PhDB,
    private readonly cfg: PhConfig,
    private readonly hub: MemoryHubClient = defaultHubClient,
  ) {}

  get hubConfigured(): boolean {
    return resolveMemoryHubConfig(this.cfg).configured;
  }

  assertConfigured(operation: string): void {
    const hub = resolveMemoryHubConfig(this.cfg);
    if (hub.url && !hub.apiKey && ['add', 'save', 'list', 'search', 'show', 'forget', 'restore', 'undo', 'retry'].includes(operation)) {
      throw new Error('Memory hub URL is configured but its API key is missing. Configure memory-hub-api-key or unset the hub URL to use local memories.');
    }
  }

  async save(input: AddMemoryInput): Promise<{ source: 'local'; memory: MemoryEntry } | { source: 'hub'; id: string }> {
    if (!this.hubConfigured) return { source: 'local', memory: this.db.addMemory(input) };

    this.db.validateMemorySources(input);
    const promptIds = [...new Set(input.prompt_ids ?? [])];
    const sourceRef = promptIds.length
      ? promptIds.map(id => `database:${this.db.databaseId}:prompt:${id}`).join(',')
      : input.source_ref;
    const id = await this.hub.save(this.cfg, {
      id: input.external_id ?? randomUUID(),
      content: input.content,
      scope: input.scope ?? (input.project ? 'project' : 'work'),
      ...(input.project ? { project: input.project } : {}),
      kind: input.kind ?? 'decision',
      sensitivity: input.sensitivity ?? 'normal',
      ...(input.sensitivity === 'sensitive' ? { explicit_sensitive: true } : {}),
      source: input.source ?? 'manual',
      ...(sourceRef ? { source_ref: sourceRef } : {}),
    });
    return { source: 'hub', id };
  }

  async search(options: SearchMemoriesOptions = {}): Promise<MemorySearchResult> {
    if (this.hubConfigured) {
      const shared = await this.hub.search(this.cfg, options.query ?? '', options.scope,
        options.limit ?? 20, Boolean(options.includeSensitive), Boolean(options.includePersonal), options.project);
      return { source: 'hub', local: [], shared };
    }
    return { source: 'local', local: this.db.searchMemories(options), shared: [] };
  }

  /** Search both stores for an agent-facing MCP memory query. */
  async searchForAgent(options: SearchMemoriesOptions = {}): Promise<MemorySearchResult> {
    const local = this.db.searchMemories(options);
    const shared = this.hubConfigured
      ? await this.hub.search(this.cfg, options.query ?? '', options.scope, options.limit ?? 10,
        Boolean(options.includeSensitive), Boolean(options.includePersonal), options.project)
      : [];
    return { source: this.hubConfigured ? 'hub' : 'local', local, shared };
  }

  /** Retrieve local context plus eligible shared project/work memories. */
  async projectContext(
    options: ProjectContextOptions,
    retrieval: ContextRetrievalOptions = {},
  ): Promise<MemoryContextResult> {
    const context = await getProjectContext(this.db, options, retrieval);
    if (!this.hubConfigured || options.includeMemories === false) return { context, shared: [] };
    try {
      const [project, work] = await Promise.all([
        this.hub.search(this.cfg, options.query ?? '', 'project', options.limit ?? 5, false, false, options.project),
        this.hub.search(this.cfg, options.query ?? '', 'work', options.limit ?? 5),
      ]);
      return { context, shared: [...project, ...work].slice(0, options.limit ?? 5) };
    } catch (error) {
      context.notes.push(`shared memory hub unavailable (${(error as Error).message}); used local memory`);
      return { context, shared: [] };
    }
  }

  async get(id: string): Promise<{ source: 'local'; memory?: MemoryEntry } | { source: 'hub'; memory?: Record<string, unknown> }> {
    if (this.hubConfigured && /^[0-9a-f-]{36}$/i.test(id)) return { source: 'hub', memory: await this.hub.get(this.cfg, id) };
    const numeric = Number(id.replace(/^#/, ''));
    if (!Number.isInteger(numeric) || numeric < 1) throw new Error('A numeric local memory ID or shared memory UUID is required.');
    return { source: 'local', memory: this.db.getMemoryById(numeric) };
  }

  async forget(id: string): Promise<{ source: 'local' | 'hub'; changed: boolean }> {
    if (this.hubConfigured && /^[0-9a-f-]{36}$/i.test(id)) return { source: 'hub', changed: await this.hub.forget(this.cfg, id) };
    const numeric = Number(id.replace(/^#/, ''));
    if (!Number.isInteger(numeric) || numeric < 1) throw new Error('A numeric local memory ID or shared memory UUID is required.');
    return { source: 'local', changed: this.db.forgetMemory(numeric) };
  }

  async restore(id: string): Promise<{ source: 'local' | 'hub' }> {
    if (this.hubConfigured && /^[0-9a-f-]{36}$/i.test(id)) {
      await this.hub.restore(this.cfg, id);
      return { source: 'hub' };
    }
    const numeric = Number(id.replace(/^#/, ''));
    if (!Number.isInteger(numeric) || numeric < 1) throw new Error('A numeric local memory ID or shared memory UUID is required.');
    if (!this.db.restoreMemory(numeric)) throw new Error(this.db.getMemoryById(numeric) ? `Memory #${numeric} is already active.` : 'Memory not found.');
    return { source: 'local' };
  }

}
