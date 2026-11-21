import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhDB } from '../../db/index.js';
import { cmdContext } from '../context.js';
import { cmdMemory } from '../memory.js';
import { cmdStatus } from '../status.js';

describe('operational memory commands', () => {
  let dir: string;
  let db: PhDB;
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    db?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  function setup() {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-ops-'));
    db = new PhDB(path.join(dir, 'ph.db'));
    db.insert({ timestamp: new Date().toISOString(), tool: 'codex', prompt: 'Fix project cache timeout', response: 'Set a finite SQLite busy timeout.', args: '', workdir: dir, hostname: 'test', exit_code: 0, metadata: JSON.stringify({ project: 'ph', summary: 'Cache fix' }) });
  }

  it('context retrieves project evidence and renders notes when embeddings are empty', async () => {
    setup();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await cmdContext(db, {}, ['--project', 'ph', 'cache', 'timeout']);
    const text = output.mock.calls.map(call => String(call[0])).join('');
    expect(text).toContain('Project: ph');
    expect(text).toContain('Interaction #1');
    expect(text).toContain('semantic index is empty');
  });

  it('memory command supports add, list, search, forget, and restore', async () => {
    setup();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // Add memory
    await cmdMemory(db, ['add', '--project', 'ph', '--kind', 'fact', 'Always use vitest']);
    expect(db.searchMemories({ project: 'ph' })).toHaveLength(1);

    // List memories
    await cmdMemory(db, ['list', '--project', 'ph']);
    let text = output.mock.calls.map(call => String(call[0])).join('');
    expect(text).toContain('Always use vitest');

    // Search memories
    output.mockClear();
    await cmdMemory(db, ['search', 'vitest']);
    text = output.mock.calls.map(call => String(call[0])).join('');
    expect(text).toContain('Always use vitest');

    // Forget memory
    const memId = db.searchMemories({ project: 'ph' })[0].id;
    await cmdMemory(db, ['forget', String(memId)]);
    expect(db.searchMemories({ project: 'ph' })).toHaveLength(0);

    // Restore memory
    await cmdMemory(db, ['restore', String(memId)]);
    expect(db.searchMemories({ project: 'ph' })).toHaveLength(1);
  });

  it('bounds combined shared + local context output with --budget and --max-chars', async () => {
    setup();
    db.addMemory({ content: 'Local architectural note: ' + 'L'.repeat(300), scope: 'project', project: 'ph' });
    db.insert({
      timestamp: new Date().toISOString(),
      tool: 'codex',
      prompt: 'Long prompt ' + 'P'.repeat(600),
      response: 'Long response ' + 'R'.repeat(600),
      args: '',
      workdir: dir,
      hostname: 'test',
      exit_code: 0,
      metadata: JSON.stringify({ project: 'ph', summary: 'Long interaction summary' }),
    });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      memories: [
        { id: '11111111-1111-4111-8111-111111111111', scope: 'project', project: 'ph', kind: 'decision', content: 'Shared note: ' + 'S'.repeat(300), source_ref: 'hub:1' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const cfg = { memoryHubUrl: 'https://hub.test', memoryHubApiKey: 'secret' };
    await cmdContext(db, cfg, ['--project', 'ph', '--budget', '600']);
    const text = output.mock.calls.map(call => String(call[0])).join('').trimEnd();
    expect(text.length).toBeLessThanOrEqual(600);
    expect(text).toContain('Shared PH Memory');

    output.mockClear();
    await cmdContext(db, cfg, ['--project', 'ph', '--max-chars', '550']);
    const aliasText = output.mock.calls.map(call => String(call[0])).join('').trimEnd();
    expect(aliasText.length).toBeLessThanOrEqual(550);
  });

  it('queues offline memory saves on transient errors, reports pending count in status, and drains with memory sync', async () => {
    setup();
    const cfg = { memoryHubUrl: 'https://hub.test', memoryHubApiKey: 'secret' };
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await cmdMemory(db, ['add', '--project', 'ph', 'Queued offline decision'], dir, cfg);
    const addText = stdout.mock.calls.map(call => String(call[0])).join('');
    expect(addText).toContain('pending hub sync');
    expect(db.countPendingHubMemories()).toBe(1);

    stdout.mockClear();
    await cmdStatus(db, cfg);
    const statusText = stdout.mock.calls.map(call => String(call[0])).join('');
    expect(statusText).toContain('Pending hub sync: 1 (run "ph memory sync")');

    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { id?: string };
      return new Response(JSON.stringify({ memory: { id: body.id ?? '22222222-2222-4222-8222-222222222222' } }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    stdout.mockClear();
    await cmdMemory(db, ['sync'], dir, cfg);
    const syncText = stdout.mock.calls.map(call => String(call[0])).join('');
    expect(syncText).toContain('Synced: 1, Failed: 0, Remaining pending: 0');
    expect(db.countPendingHubMemories()).toBe(0);
    expect(process.exitCode).toBeUndefined();

    // Unconfigured hub sets exitCode = 1 cleanly
    await cmdMemory(db, ['sync'], dir, {});
    expect(process.exitCode).toBe(1);
    expect(stderr.mock.calls.map(call => String(call[0])).join('')).toContain('Memory hub is not configured');
  });
});
