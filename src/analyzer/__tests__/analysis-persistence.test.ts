import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhDB } from '../../db/index.js';
import { analyzeAll } from '../index.js';
import type { LLMProvider } from '../../ai/provider.js';

describe('per-interaction analysis ownership (SPEC-018)', () => {
  let dir: string;
  let db: PhDB;

  afterEach(() => {
    vi.restoreAllMocks();
    db?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('stores analysis on the source interaction without promoting project memory', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-analysis-'));
    db = new PhDB(path.join(dir, 'ph.db'));
    const id = db.insert({
      timestamp: new Date().toISOString(), tool: 'codex', prompt: 'Explain the PH cache policy',
      response: 'Use a stable project-scoped key.', args: '', workdir: dir, hostname: 'test', exit_code: 0,
      metadata: '{}',
    });
    const provider: LLMProvider = {
      name: 'test',
      generate: vi.fn().mockResolvedValue(JSON.stringify({
        project: 'ph', summary: 'Explained the cache policy', key_insights: ['Use project scope'],
        technical_decisions: ['Keep one stable key'], quality: 8, relevance: 9,
      })),
    };

    const result = await analyzeAll([db.getById(id)!], provider, db);
    const metadata = JSON.parse(db.getById(id)!.metadata) as Record<string, unknown>;
    expect(result.updated).toBe(1);
    expect(metadata['analysis_status']).toBe('complete');
    expect(metadata['technical_decisions']).toEqual(['Keep one stable key']);
    expect(db.getAllMemoriesByProject('ph')).toEqual([]);
    expect(db.getProjectSummary('ph')).toBeNull();
  });

  it('dry-run analysis leaves metadata and lifecycle status untouched', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-analysis-dry-'));
    db = new PhDB(path.join(dir, 'ph.db'));
    const id = db.insert({
      timestamp: new Date().toISOString(), tool: 'codex', prompt: 'A new task', response: '',
      args: '', workdir: dir, hostname: 'test', exit_code: 0, metadata: JSON.stringify({ project: 'ph' }),
    });
    const provider: LLMProvider = { name: 'test', generate: vi.fn().mockResolvedValue('not JSON') };

    await analyzeAll([db.getById(id)!], provider, db, { dryRun: true });
    expect(JSON.parse(db.getById(id)!.metadata)).toEqual({ project: 'ph' });
  });
});
