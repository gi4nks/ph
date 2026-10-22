import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhDB } from '../../db/index.js';
import { cmdClose } from '../close.js';
import { cmdPrepare } from '../prepare.js';

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

  it('prepare falls back to recent project evidence and does not write', async () => {
    setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const before = db.getPromptCount();
    await cmdPrepare(db, {}, ['--project', 'ph', 'cache', 'timeout']);
    expect(output.mock.calls.map(call => String(call[0])).join('')).toContain('Semantic retrieval unavailable');
    expect(output.mock.calls.map(call => String(call[0])).join('')).toContain('Interaction #1');
    expect(db.getPromptCount()).toBe(before);
    expect(db.searchMemories('ph')).toHaveLength(0);
  });

  it('close dry-run only displays selected source prompts', async () => {
    setup();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await cmdClose(db, {}, ['--project', 'ph', '--from', '1', '--to', '1', '--dry-run']);
    expect(output.mock.calls.map(call => String(call[0])).join('')).toContain('Dry run');
    expect(db.searchMemories('ph')).toHaveLength(0);
    expect(db.getProjectSummary('ph')).toBeNull();
  });
});
