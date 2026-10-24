import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhDB } from '../../db/index.js';
import { cmdShow } from '../show.js';
import { cmdExport } from '../export.js';
import { cmdStatus } from '../status.js';
import { printResults } from '../../display/print.js';
import type { PhConfig } from '../../config/index.js';

describe('single interaction inspection (SPEC-018)', () => {
  let dir: string;
  let db: PhDB;
  let output: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-detail-'));
    db = new PhDB(path.join(dir, 'ph.db'));
    output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function insert(metadata: Record<string, unknown> = {}) {
    return db.insert({
      timestamp: '2026-10-24T10:00:00.000Z', tool: 'codex',
      prompt: 'A complete stored prompt', response: 'A complete stored response',
      args: '--model test', workdir: '/project/ph', hostname: 'test-host', exit_code: 0,
      metadata: JSON.stringify({
        project: 'ph', role: 'debug', summary: 'Fixed a sample bug',
        key_insights: ['The cache key was stale'], technical_decisions: ['Use stable keys'],
        quality: 8, relevance: 9, ...metadata,
      }),
    });
  }

  it('shows full prompt, response, capture metadata, and derived analysis', async () => {
    const id = insert();
    await cmdShow(db, [String(id)]);
    const text = output.mock.calls.map((call: unknown[]) => String(call[0])).join('');
    expect(text).toContain('A complete stored prompt');
    expect(text).toContain('A complete stored response');
    expect(text).toContain('Fixed a sample bug');
    expect(text).toContain('The cache key was stale');
    expect(text).toContain('Use stable keys');
    expect(text).toContain('Analysis: complete');
  });

  it('shows absent response and analysis explicitly', async () => {
    const id = insert({ summary: undefined, key_insights: [], technical_decisions: [], quality: undefined, relevance: undefined });
    db.updateResponse(id, '');
    await cmdShow(db, [String(id)]);
    const text = output.mock.calls.map((call: unknown[]) => String(call[0])).join('');
    expect(text).toContain('Response captured: no');
    expect(text).toContain('Analysis: not analyzed');
    expect(text).toContain('(No response captured)');
  });

  it('exports complete pairs and analysis metadata in each supported format', async () => {
    const id = insert();
    for (const format of ['txt', 'md', 'json']) {
      output.mockClear();
      await cmdExport(db, [String(id), '--format', format]);
      const text = output.mock.calls.map((call: unknown[]) => String(call[0])).join('');
      expect(text).toContain('A complete stored prompt');
      expect(text).toContain('A complete stored response');
      if (format === 'json') {
        const parsed = JSON.parse(text) as { metadata: { summary?: string }; analysis: { technical_decisions: string[] } };
        expect(parsed.metadata.summary).toBe('Fixed a sample bug');
        expect(parsed.analysis.technical_decisions).toContain('Use stable keys');
      } else {
        expect(text).toContain('Fixed a sample bug');
        expect(text).toContain('Use stable keys');
      }
    }
  });

  it('shows archived interactions through their original ID', async () => {
    const id = insert();
    db.archivePrompts([id]);
    await cmdShow(db, [String(id), '--archive']);
    const text = output.mock.calls.map((call: unknown[]) => String(call[0])).join('');
    expect(text).toContain('A complete stored prompt');
    expect(text).toContain('A complete stored response');
  });

  it('makes search results actionable and full mode shows both texts', () => {
    insert();
    printResults(db.search({ query: 'complete', limit: 5 }), false);
    expect(output.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain('Inspect: ph show 1');
    output.mockClear();
    printResults(db.search({ query: 'complete', limit: 5 }), true);
    const text = output.mock.calls.map((call: unknown[]) => String(call[0])).join('');
    expect(text).toContain('A complete stored prompt');
    expect(text).toContain('A complete stored response');
  });

  it('shows recent capture and lifecycle state without printing record content', async () => {
    insert({ analysis_status: 'failed', analysis_error: 'analysis_failed', remote_sync_status: 'complete' });
    await cmdStatus(db, { backgroundAnalysis: true } as PhConfig);
    const text = output.mock.calls.map((call: unknown[]) => String(call[0])).join('');
    expect(text).toContain('analysis: failed');
    expect(text).toContain('remote: complete');
    expect(text).not.toContain('A complete stored prompt');
    expect(text).not.toContain('A complete stored response');
  });
});
