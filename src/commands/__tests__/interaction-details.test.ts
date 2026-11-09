import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhDB } from '../../db/index.js';
import { formatInteractionDetail } from '../../interaction/detail.js';
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

  it('shows a compact summary by default and hides long text bodies', async () => {
    const id = insert();
    await cmdShow(db, [String(id)]);
    const text = output.mock.calls.map((call: unknown[]) => String(call[0])).join('');
    expect(text).not.toContain('A complete stored prompt');
    expect(text).not.toContain('A complete stored response');
    expect(text).toContain(`Use ph show ${id} --prompt or --full to display`);
    expect(text).toContain(`Use ph show ${id} --full to display`);
    expect(text).toContain('Fixed a sample bug');
    expect(text).toContain('The cache key was stale');
    expect(text).toContain('Use stable keys');
    expect(text).toContain('Analysis status');
    expect(text).toContain('complete');
  });

  it('reveals only the requested body with --prompt and both bodies with --full', async () => {
    const id = insert();
    await cmdShow(db, [String(id), '--prompt']);
    let text = output.mock.calls.map((call: unknown[]) => String(call[0])).join('');
    expect(text).toContain('A complete stored prompt');
    expect(text).not.toContain('A complete stored response');

    output.mockClear();
    await cmdShow(db, [String(id), '--full']);
    text = output.mock.calls.map((call: unknown[]) => String(call[0])).join('');
    expect(text).toContain('A complete stored prompt');
    expect(text).toContain('A complete stored response');
  });

  it('groups capture details, prompt, and response into readable sections', async () => {
    const id = insert();
    await cmdShow(db, [String(id), '--full']);
    const text = output.mock.calls.map((call: unknown[]) => String(call[0])).join('');
    expect(text.indexOf('CAPTURE DETAILS')).toBeLessThan(text.indexOf('PROMPT'));
    expect(text.indexOf('PROMPT')).toBeLessThan(text.indexOf('RESPONSE'));
    expect(text).toMatch(/Date\s+2026-10-24T10:00:00\.000Z/);
    expect(text).toContain('  A complete stored prompt');
    expect(text).toContain('  A complete stored response');
    expect(text).not.toContain('\u001b[');
  });

  it('adds restrained ANSI color only when requested by the terminal layer', () => {
    const id = insert();
    const entry = db.getById(id);
    expect(entry).not.toBeNull();
    const colored = formatInteractionDetail(entry!, { color: true });
    expect(colored).toContain('\u001b[36m');
    expect(formatInteractionDetail(entry!)).not.toContain('\u001b[');
  });

  it('honors FORCE_COLOR and NO_COLOR while keeping JSON color-free', async () => {
    const id = insert();
    const previousForceColor = process.env.FORCE_COLOR;
    const previousNoColor = process.env.NO_COLOR;
    try {
      process.env.FORCE_COLOR = '1';
      delete process.env.NO_COLOR;
      await cmdShow(db, [String(id)]);
      expect(output.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain('\u001b[');

      output.mockClear();
      process.env.NO_COLOR = '';
      await cmdShow(db, [String(id)]);
      expect(output.mock.calls.map((call: unknown[]) => String(call[0])).join('')).not.toContain('\u001b[');

      output.mockClear();
      await cmdShow(db, [String(id), '--json']);
      const json = output.mock.calls.map((call: unknown[]) => String(call[0])).join('');
      expect(() => JSON.parse(json)).not.toThrow();
      expect(json).not.toContain('\u001b[');
    } finally {
      if (previousForceColor === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = previousForceColor;
      if (previousNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previousNoColor;
    }
  });

  it('shows absent response and analysis explicitly', async () => {
    const id = insert({ summary: undefined, key_insights: [], technical_decisions: [], quality: undefined, relevance: undefined });
    db.updateResponse(id, '');
    await cmdShow(db, [String(id)]);
    const text = output.mock.calls.map((call: unknown[]) => String(call[0])).join('');
    expect(text).toMatch(/Response captured\s+no/);
    expect(text).toContain('Analysis status');
    expect(text).toContain('not analyzed');
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
    await cmdShow(db, [String(id), '--archive', '--full']);
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
