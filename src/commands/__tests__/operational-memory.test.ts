import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhDB } from '../../db/index.js';
import { cmdContext } from '../context.js';
import { cmdMemory } from '../memory.js';

describe('operational memory commands', () => {
  let dir: string;
  let db: PhDB;
  afterEach(() => {
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
});
