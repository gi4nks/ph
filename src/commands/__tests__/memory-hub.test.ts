import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cmdMemoryHub, searchHubMemories, saveHubMemory } from '../memory-hub.js';
import { PhDB } from '../../db/index.js';

const tempDirs: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

describe('PH memory hub client', () => {
  it('saves sensitive memories only with explicit sensitive consent', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string; headers?: Record<string, string> }) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(payload['sensitivity']).toBe('sensitive');
      expect(payload['explicit_sensitive']).toBe(true);
      expect(init?.headers?.['Authorization']).toBe('Bearer client-key');
      return new Response(JSON.stringify({ memory: { id: 'memory-id' } }), { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await cmdMemoryHub({ memoryHubUrl: 'https://memory.example/', memoryHubApiKey: 'client-key' }, ['save', 'Private note', '--scope', 'personal', '--sensitive']);
      expect(fetchMock).toHaveBeenCalledWith('https://memory.example/api/memories', expect.objectContaining({ method: 'POST' }));
    } finally { output.mockRestore(); }
  });

  it('does not include sensitive records in coding context retrieval', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(payload['include_sensitive']).toBe(false);
      return new Response(JSON.stringify({ memories: [{ content: 'A work preference', source: 'manual' }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchHubMemories({ memoryHubUrl: 'https://memory.example', memoryHubApiKey: 'key' }, 'task', 'work'))
      .resolves.toEqual([{ content: 'A work preference', source: 'manual' }]);
  });

  it('saves reviewed project knowledge with a source reference', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(payload).toMatchObject({ scope: 'project', kind: 'project-knowledge', source_ref: 'prompt:9,prompt:10', sensitivity: 'normal' });
      return new Response(JSON.stringify({ memory: { id: 'memory-id' } }), { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(saveHubMemory({ memoryHubUrl: 'https://memory.example', memoryHubApiKey: 'key' }, {
      content: 'Decision details', scope: 'project', kind: 'project-knowledge', source: 'ph-close', source_ref: 'prompt:9,prompt:10',
    })).resolves.toBe('memory-id');
  });

  it('reversibly forgets automatic memories linked to an interaction ID', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-memory-undo-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'ph.db');
    const db = new PhDB(dbPath);
    db.insert({ timestamp: new Date().toISOString(), tool: 'codex', prompt: 'Use concise responses.', response: 'Done.', args: '', workdir: dir, hostname: 'test', exit_code: 0, metadata: JSON.stringify({ automatic_memory_ids: ['memory-one'] }) });
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ restored: false }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await cmdMemoryHub({ memoryHubUrl: 'https://memory.example', memoryHubApiKey: 'key' }, ['undo', '1'], dbPath);
      expect(fetchMock).toHaveBeenCalledWith('https://memory.example/api/memories/memory-one', expect.objectContaining({ method: 'DELETE' }));
      expect(output.mock.calls.map(call => String(call[0])).join('')).toContain('memory-one');
    } finally { output.mockRestore(); db.close(); }
  });
});
