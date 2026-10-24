import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhDB } from '../../db/index.js';
import { cmdSearch } from '../search.js';

vi.mock('../../embedding/index.js', () => ({ getEmbeddings: vi.fn() }));
import { getEmbeddings } from '../../embedding/index.js';
import { cmdSearchSemantic } from '../search.js';

describe('ph search defaults', () => {
  let root = '';
  let db: PhDB | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getEmbeddings).mockReset();
    db?.close();
    db = undefined;
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function setup() {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-search-cli-'));
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    db = new PhDB(path.join(root, 'history.db'));
    for (let index = 0; index < 7; index++) {
      db.insert({ timestamp: new Date(Date.UTC(2026, 9, 1, index)).toISOString(), tool: 'codex', prompt: `silver cache result ${index}`, response: '', args: '', workdir: root, hostname: 'test', exit_code: 0, metadata: JSON.stringify({ project: path.basename(root) }) });
    }
    db.insert({ timestamp: '2026-10-02T00:00:00.000Z', tool: 'claude', prompt: 'silver cache from another project', response: '', args: '', workdir: '/other', hostname: 'test', exit_code: 0, metadata: JSON.stringify({ project: 'other-project' }) });
  }

  it('searches the current project and shows five results by default', async () => {
    setup();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await cmdSearch(db!, {}, ['silver']);
    const text = output.mock.calls.map(([chunk]) => String(chunk)).join('') + log.mock.calls.flat().join(' ');
    expect(text).toContain(`Project: ${path.basename(root)}`);
    expect(text).toContain('5 result(s)');
    expect(text).not.toContain('another project');
  });

  it('searches every project only when --all is requested', async () => {
    setup();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await cmdSearch(db!, {}, ['--all', '--limit', '10', 'silver']);
    const text = output.mock.calls.map(([chunk]) => String(chunk)).join('') + log.mock.calls.flat().join(' ');
    expect(text).toContain('Scope: all projects');
    expect(text).toContain('another project');
  });

  it('explains how to broaden a project search with no matches', async () => {
    setup();
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await cmdSearch(db!, {}, ['missing phrase']);
    expect(output.mock.calls.map(([chunk]) => String(chunk)).join('') + log.mock.calls.flat().join(' ')).toContain('Use ph search --all to search other projects.');
  });

  it('loads project embeddings through the scoped database query', async () => {
    setup();
    vi.mocked(getEmbeddings).mockResolvedValue([new Float32Array([1, 0])]);
    const scoped = vi.spyOn(db!, 'getEmbeddingsForProject');
    const all = vi.spyOn(db!, 'getAllEmbeddings');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await cmdSearchSemantic(db!, {}, 'cache', 5, false, path.basename(root));

    expect(scoped).toHaveBeenCalledWith(path.basename(root));
    expect(all).not.toHaveBeenCalled();
  });
});
