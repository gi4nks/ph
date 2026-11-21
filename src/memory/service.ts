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

export type SaveMemoryResult =
  | { source: 'local'; memory: MemoryEntry; pendingSync?: boolean; warning?: string }
  | { source: 'hub'; id: string; pendingSync?: boolean; warning?: string };

export interface FlushHubSyncResult {
  synced: number;
  failed: number;
  remaining: number;
  errors: string[];
}

const TRANSIENT_NET_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNABORTED',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * Determine whether a hub write error is transient (network/timeout/5xx) and
 * eligible for offline local queuing, vs. a client/auth/policy failure (4xx).
 */
export function isTransientHubError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'string') {
    if (/\b(?:HTTP\s*)?(?:400|401|403|404|409|422)\b|\((?:400|401|403|404|409|422)\)/i.test(err)) return false;
    if (/explicit_sensitive|unauthorized|forbidden|policy/i.test(err)) return false;
    return /\b(?:500|502|503|504)\b|\(5\d\d\)|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|fetch failed|timed out|timeout|network|socket hang up|offline/i.test(err);
  }
  if (typeof err !== 'object') return false;

  const record = err as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    name?: unknown;
    message?: unknown;
    cause?: { code?: unknown; message?: unknown };
  };

  const status = typeof record.status === 'number'
    ? record.status
    : typeof record.statusCode === 'number'
      ? record.statusCode
      : undefined;
  if (status !== undefined) {
    if (status >= 400 && status < 500) return false;
    if (status >= 500) return true;
  }

  const message = err instanceof Error ? err.message : String(record.message ?? '');
  if (/\b(?:HTTP\s*)?(?:400|401|403|404|409|422)\b|\((?:400|401|403|404|409|422)\)/i.test(message)) return false;
  if (/explicit_sensitive|unauthorized|forbidden|policy/i.test(message)) return false;

  const code = typeof record.code === 'string'
    ? record.code
    : typeof record.cause?.code === 'string'
      ? record.cause.code
      : undefined;
  if (code && TRANSIENT_NET_CODES.has(code)) return true;

  if (record.name === 'AbortError' || record.name === 'TimeoutError') return true;
  if (err instanceof TypeError) return true;

  return /\b(?:500|502|503|504)\b|\(5\d\d\)|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|fetch failed|timed out|timeout|network|socket hang up|offline/i.test(message);
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
    if (hub.url && !hub.apiKey && ['add', 'save', 'list', 'search', 'show', 'forget', 'restore', 'undo', 'retry', 'sync'].includes(operation)) {
      throw new Error('Memory hub URL is configured but its API key is missing. Configure memory-hub-api-key or unset the hub URL to use local memories.');
    }
  }

  async save(input: AddMemoryInput): Promise<SaveMemoryResult> {
    if (!this.hubConfigured) return { source: 'local', memory: this.db.addMemory(input) };

    this.db.validateMemorySources(input);
    const promptIds = [...new Set(input.prompt_ids ?? [])];
    const sourceRef = promptIds.length
      ? promptIds.map(id => `database:${this.db.databaseId}:prompt:${id}`).join(',')
      : input.source_ref;
    const externalId = input.external_id ?? randomUUID();
    const scope = input.scope ?? (input.project ? 'project' : 'work');

    try {
      const id = await this.hub.save(this.cfg, {
        id: externalId,
        content: input.content,
        scope,
        ...(input.project ? { project: input.project } : {}),
        kind: input.kind ?? 'decision',
        sensitivity: input.sensitivity ?? 'normal',
        ...(input.sensitivity === 'sensitive' ? { explicit_sensitive: true } : {}),
        source: input.source ?? 'manual',
        ...(sourceRef ? { source_ref: sourceRef } : {}),
      });
      this.db.addMemory({
        ...input,
        prompt_ids: promptIds,
        external_id: id,
        ...(sourceRef ? { source_ref: sourceRef } : {}),
        hub_sync_status: 'synced',
      });
      return { source: 'hub', id };
    } catch (error) {
      if (!isTransientHubError(error)) throw error;
      const savedEntry = this.db.addMemory({
        ...input,
        prompt_ids: promptIds,
        external_id: externalId,
        ...(sourceRef ? { source_ref: sourceRef } : {}),
        hub_sync_status: 'pending',
      });
      const reason = error instanceof Error ? error.message : String(error);
      return {
        source: 'local',
        memory: savedEntry,
        pendingSync: true,
        warning: `Memory hub unavailable (${reason}); saved locally with pending hub sync.`,
      };
    }
  }

  countPendingHubSync(): number {
    return this.db.countPendingHubMemories();
  }

  async flushPendingHubSync(limit = 50): Promise<FlushHubSyncResult> {
    if (!this.hubConfigured) {
      throw new Error('Memory hub is not configured.');
    }

    const pending = this.db.listPendingHubMemories(limit);
    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const entry of pending) {
      if (entry.sensitivity === 'sensitive' || entry.scope === 'personal') {
        continue;
      }
      const sourceRef = entry.source_ref ?? (
        entry.prompt_ids.length
          ? entry.prompt_ids.map(id => `database:${this.db.databaseId}:prompt:${id}`).join(',')
          : undefined
      );
      try {
        const externalId = await this.hub.save(this.cfg, {
          id: entry.external_id ?? randomUUID(),
          content: entry.content,
          scope: entry.scope,
          ...(entry.project ? { project: entry.project } : {}),
          kind: entry.kind,
          sensitivity: entry.sensitivity,
          source: entry.source,
          ...(sourceRef ? { source_ref: sourceRef } : {}),
        });
        this.db.markMemoryHubSynced(entry.id, externalId);
        synced++;
      } catch (error) {
        failed++;
        const raw = error instanceof Error ? error.message : String(error);
        const clean = raw.replace(/\s+/g, ' ').trim();
        errors.push(`#${entry.id}: ${clean.length > 160 ? `${clean.slice(0, 157)}...` : clean}`);
      }
    }

    return {
      synced,
      failed,
      remaining: this.db.countPendingHubMemories(),
      errors,
    };
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
