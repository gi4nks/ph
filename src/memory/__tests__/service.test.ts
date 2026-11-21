import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhDB } from '../../db/index.js';
import type { MemoryHubClient } from '../service.js';
import { isTransientHubError, MemoryService } from '../service.js';

describe('MemoryService source policy', () => {
  let directory = '';
  let db: PhDB | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
    directory = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function setup() {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-memory-service-'));
    db = new PhDB(path.join(directory, 'ph.db'));
    db.insert({
      timestamp: new Date().toISOString(), tool: 'codex', prompt: 'Add project-level memory routing',
      response: 'Keep storage behind the service boundary.', args: '', workdir: directory, hostname: 'test', exit_code: 0,
      metadata: JSON.stringify({ project: 'ph' }),
    });
    return db;
  }

  function hub(overrides: Partial<MemoryHubClient> = {}): MemoryHubClient {
    return {
      save: vi.fn(async (_cfg, input) => input.id ?? 'shared-memory-id'),
      search: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
      forget: vi.fn(async () => false),
      restore: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  it('validates prompt provenance locally and sends a database-scoped source to the hub', async () => {
    const local = setup();
    const client = hub();
    const service = new MemoryService(local, { memoryHubUrl: 'https://hub.test', memoryHubApiKey: 'secret' }, client);

    await expect(service.save({ content: 'A durable project decision', scope: 'project', project: 'ph', prompt_ids: [999] }))
      .rejects.toThrow('Source prompt #999 does not exist.');

    const result = await service.save({ content: 'A durable project decision', scope: 'project', project: 'ph', prompt_ids: [1] });
    expect(result).toEqual({ source: 'hub', id: expect.any(String) });
    expect(client.save).toHaveBeenCalledWith(expect.objectContaining({ memoryHubUrl: 'https://hub.test' }), expect.objectContaining({
      source_ref: `database:${local.databaseId}:prompt:1`,
    }));
    const localRows = local.searchMemories({ project: 'ph' });
    expect(localRows).toHaveLength(1);
    expect(localRows[0].hub_sync_status).toBe('synced');
    expect(localRows[0].external_id).toBe((result as { source: 'hub'; id: string }).id);
  });

  it('queues offline memories as pending on transient hub errors, fails fast on 401/403, and flushes once hub recovers', async () => {
    expect(isTransientHubError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(isTransientHubError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientHubError(Object.assign(new Error('Bad Gateway'), { status: 502 }))).toBe(true);
    expect(isTransientHubError(Object.assign(new Error('Unauthorized'), { status: 401 }))).toBe(false);
    expect(isTransientHubError(new Error('Memory hub request failed (403).'))).toBe(false);
    expect(isTransientHubError(new Error('sensitive memories require explicit_sensitive: true'))).toBe(false);

    const local = setup();
    const cfg = { memoryHubUrl: 'https://hub.test', memoryHubApiKey: 'secret' };

    const offlineClient = hub({
      save: vi.fn(async () => {
        throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8787'), { code: 'ECONNREFUSED' });
      }),
    });
    const offlineService = new MemoryService(local, cfg, offlineClient);

    const queued = await offlineService.save({
      content: 'Offline queued architecture note',
      scope: 'project',
      project: 'ph',
      prompt_ids: [1],
    });
    expect(queued.source).toBe('local');
    expect(queued.pendingSync).toBe(true);
    expect(queued.warning).toContain('ECONNREFUSED');
    if (queued.source === 'local') {
      expect(queued.memory.hub_sync_status).toBe('pending');
      expect(queued.memory.external_id).toBeTruthy();
    }
    expect(offlineService.countPendingHubSync()).toBe(1);

    const authErrorClient = hub({
      save: vi.fn(async () => {
        throw Object.assign(new Error('Memory hub request failed (401).'), { status: 401 });
      }),
    });
    const authService = new MemoryService(local, cfg, authErrorClient);
    await expect(authService.save({
      content: 'Should not queue on 401',
      scope: 'project',
      project: 'ph',
    })).rejects.toThrow('401');
    expect(offlineService.countPendingHubSync()).toBe(1);

    const forbiddenClient = hub({
      save: vi.fn(async () => {
        throw Object.assign(new Error('Forbidden'), { status: 403 });
      }),
    });
    const forbiddenService = new MemoryService(local, cfg, forbiddenClient);
    await expect(forbiddenService.save({
      content: 'Should not queue on 403',
      scope: 'project',
      project: 'ph',
    })).rejects.toThrow('Forbidden');

    const recoveredClient = hub({
      save: vi.fn(async (_cfg, input) => input.id ?? 'recovered-id'),
    });
    const recoveredService = new MemoryService(local, cfg, recoveredClient);
    const flushed = await recoveredService.flushPendingHubSync();
    expect(flushed).toEqual({ synced: 1, failed: 0, remaining: 0, errors: [] });
    expect(recoveredService.countPendingHubSync()).toBe(0);
    const rows = local.searchMemories({ project: 'ph' });
    expect(rows).toHaveLength(1);
    expect(rows[0].hub_sync_status).toBe('synced');
  });

  it('centralizes local and shared context retrieval and falls back to local memories when the hub is unavailable', async () => {
    const local = setup();
    local.addMemory({ content: 'Local memory', scope: 'project', project: 'ph' });
    const client = hub({ search: vi.fn(async (_cfg, _query, scope) => [{ id: `${scope}-shared`, scope, content: `${scope} shared` }]) });
    const service = new MemoryService(local, { memoryHubUrl: 'https://hub.test', memoryHubApiKey: 'secret' }, client);

    const retrieved = await service.projectContext({ project: 'ph', query: 'memory routing', limit: 3 });
    expect(retrieved.context.memories.map(memory => memory.content)).toContain('Local memory');
    expect(retrieved.shared).toHaveLength(2);
    expect(client.search).toHaveBeenCalledTimes(2);
    expect(client.search).toHaveBeenCalledWith(expect.anything(), 'memory routing', 'project', 3, false, false, 'ph');
    expect(client.search).toHaveBeenCalledWith(expect.anything(), 'memory routing', 'work', 3);

    const unavailable = new MemoryService(local, { memoryHubUrl: 'https://hub.test', memoryHubApiKey: 'secret' },
      hub({ search: vi.fn(async () => { throw new Error('offline'); }) }));
    const fallback = await unavailable.projectContext({ project: 'ph', limit: 3 });
    expect(fallback.context.memories.map(memory => memory.content)).toContain('Local memory');
    expect(fallback.context.notes.join(' ')).toContain('shared memory hub unavailable (offline)');
    expect(fallback.shared).toEqual([]);
  });
});
