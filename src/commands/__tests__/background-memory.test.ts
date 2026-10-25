import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhDB } from '../../db/index.js';
import { extractAndSaveAutomaticMemory } from '../background-memory.js';

describe('automatic memory worker', () => {
  let dirs: string[] = [];
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    dirs = [];
  });

  it('extracts from completed work, writes only the derived memory, and records reversible provenance', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-auto-memory-'));
    dirs.push(dir);
    const dbPath = path.join(dir, 'ph.db');
    const db = new PhDB(dbPath);
    const id = db.insert({
      timestamp: new Date().toISOString(), tool: 'codex', prompt: 'Keep all technical answers concise.',
      response: 'Understood. I will keep the technical answers concise.', args: '', workdir: dir,
      hostname: 'local', exit_code: 0, metadata: '{}',
    });
    const provider = { name: 'fixture', generate: vi.fn(async prompt => {
      expect(prompt).toContain('User prompt:');
      expect(prompt).toContain('Assistant response:');
      return JSON.stringify({ memories: [{ scope: 'work', kind: 'work-preference', content: 'Keep technical answers concise.', evidence: 'Keep all technical answers concise', sensitive: false }] });
    }) };
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        scope: 'work', kind: 'work-preference', source: 'ph-auto-capture', source_ref: `prompt:${id}:1`, sensitivity: 'normal',
      });
      expect(body['content']).toBe('Keep technical answers concise.');
      return new Response(JSON.stringify({ memory: { id: body['id'] } }), { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await extractAndSaveAutomaticMemory(db, id, dbPath,
      { memoryHubUrl: 'https://memory.example', memoryHubApiKey: 'private-key' }, provider);

    const metadata = JSON.parse(db.getById(id)!.metadata) as Record<string, unknown>;
    expect(metadata['automatic_memory_status']).toBe('complete');
    expect(metadata['automatic_memory_ids']).toHaveLength(1);
    expect(metadata['automatic_memory_error']).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    db.close();
  });

  it('leaves no memory when the model flags a sensitive candidate', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-auto-memory-sensitive-'));
    dirs.push(dir);
    const dbPath = path.join(dir, 'ph.db');
    const db = new PhDB(dbPath);
    const id = db.insert({ timestamp: new Date().toISOString(), tool: 'claude', prompt: 'A private health fact.', response: 'Acknowledged.', args: '', workdir: dir, hostname: 'local', exit_code: 0, metadata: '{}' });
    const provider = { name: 'fixture', generate: async () => JSON.stringify({ memories: [{ scope: 'work', kind: 'work-preference', content: 'The user has a medical diagnosis of migraine.', evidence: 'A private health fact', sensitive: true }] }) };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await extractAndSaveAutomaticMemory(db, id, dbPath, { memoryHubUrl: 'https://memory.example', memoryHubApiKey: 'key' }, provider);

    expect(JSON.parse(db.getById(id)!.metadata).automatic_memory_status).toBe('empty');
    expect(fetchMock).not.toHaveBeenCalled();
    db.close();
  });
});
