import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhDB } from '../../db/index.js';
import { cmdImport } from '../import.js';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('../../background/automatic-memory.js', () => ({ spawnAutomaticMemoryExtraction: spawnMock }));

describe('Codex live transcript import memory trigger', () => {
  let dir = '';
  afterEach(() => {
    vi.restoreAllMocks();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = '';
    spawnMock.mockReset();
  });

  it('schedules extraction only for newly imported interactions from a live transcript file', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-codex-auto-memory-'));
    const project = path.join(dir, 'project');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'package.json'), '{}');
    const transcript = path.join(dir, 'rollout-live.jsonl');
    fs.writeFileSync(transcript, [
      JSON.stringify({ type: 'session_meta', payload: { cwd: project } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Please keep technical answers concise.' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Understood.' }] } }),
    ].join('\n'));
    const dbPath = path.join(dir, 'ph.db');
    const db = new PhDB(dbPath);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await cmdImport(db, { memoryHubUrl: 'https://memory.example', memoryHubApiKey: 'key' }, [
        'codex', '--file', transcript, '--workdir', project,
      ]);
      const [entry] = db.getAllPrompts();
      expect(JSON.parse(entry.metadata).automatic_memory_status).toBe('pending');
      expect(spawnMock).toHaveBeenCalledOnce();
      expect(spawnMock).toHaveBeenCalledWith(entry.id, dbPath);
    } finally { output.mockRestore(); logs.mockRestore(); db.close(); }
  });
});
