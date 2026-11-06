import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhDB } from '../../db/index.js';
import type { MemoryHubClient } from '../service.js';
import { MemoryService } from '../service.js';

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
