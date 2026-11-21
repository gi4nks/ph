import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhDB } from '../../db/index.js';
import { cmdCleanup, runRetention } from '../cleanup.js';

describe('cmdCleanup & runRetention paginated scaling (A-03)', () => {
  let root = '';
  let db: PhDB | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    db?.close();
    db = undefined;
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function createDb(): PhDB {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-cleanup-test-'));
    db = new PhDB(path.join(root, 'history.db'));
    return db;
  }

  it('streams >550 prompts with --empty --apply across batches without calling db.search', async () => {
    const testDb = createDb();
    const now = Date.now();

    // Seed 600 prompts: 560 empty prompts interleaved across batches (>500) + 40 valid prompts
    for (let i = 0; i < 600; i++) {
      const isValid = i % 15 === 0; // 40 valid prompts
      const promptText = isValid
        ? `Valid detailed engineering prompt number ${i} with enough length`
        : (i % 2 === 0 ? '' : '   ');
      testDb.insert({
        timestamp: new Date(now - (600 - i) * 60_000).toISOString(),
        tool: 'codex',
        prompt: promptText,
        response: '',
        args: '',
        workdir: '/repo',
        hostname: 'test',
        exit_code: 0,
        metadata: JSON.stringify({ project: 'demo' }),
      });
    }

    const searchSpy = vi.spyOn(testDb, 'search');
    const deleteByIdsSpy = vi.spyOn(testDb, 'deleteByIds');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await cmdCleanup(testDb, {}, ['--empty', '--apply']);

    expect(searchSpy).not.toHaveBeenCalled();
    expect(deleteByIdsSpy).toHaveBeenCalledTimes(2);
    expect(deleteByIdsSpy.mock.calls[0][0]).toHaveLength(500);
    expect(deleteByIdsSpy.mock.calls[1][0]).toHaveLength(60);
    expect(testDb.getPromptCount()).toBe(40);
  });

  it('preserves the newest duplicate prompt across 500-row batches', async () => {
    const testDb = createDb();
    const baseTs = Date.UTC(2026, 9, 1, 0, 0, 0);

    const olderDupId = testDb.insert({
      timestamp: new Date(baseTs).toISOString(),
      tool: 'claude',
      prompt: 'Repeated architecture decision query across batches',
      response: '',
      args: '',
      workdir: '/repo',
      hostname: 'test',
      exit_code: 0,
      metadata: '{}',
    });

    for (let i = 1; i <= 540; i++) {
      testDb.insert({
        timestamp: new Date(baseTs + i * 60_000).toISOString(),
        tool: 'claude',
        prompt: `Unique substantive prompt #${i} in test suite`,
        response: '',
        args: '',
        workdir: '/repo',
        hostname: 'test',
        exit_code: 0,
        metadata: '{}',
      });
    }

    const newerDupId = testDb.insert({
      timestamp: new Date(baseTs + 600 * 60_000).toISOString(),
      tool: 'claude',
      prompt: 'Repeated architecture decision query across batches',
      response: '',
      args: '',
      workdir: '/repo',
      hostname: 'test',
      exit_code: 0,
      metadata: '{}',
    });

    const searchSpy = vi.spyOn(testDb, 'search');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await cmdCleanup(testDb, {}, ['--duplicates', '--apply']);

    expect(searchSpy).not.toHaveBeenCalled();
    expect(testDb.getById(olderDupId)).toBeUndefined();
    expect(testDb.getById(newerDupId)).toBeDefined();
    expect(testDb.getPromptCount()).toBe(541);
  });

  it('runRetention archives >500 matching prompts in bounded 500-row chunks without db.search', async () => {
    const testDb = createDb();
    const now = Date.now();
    const oldTs = new Date(now - 120 * 86_400_000).toISOString();
    const recentTs = new Date(now - 5 * 86_400_000).toISOString();

    // 520 old unprotected prompts + 40 old starred prompts + 40 recent prompts = 600 prompts
    for (let i = 0; i < 600; i++) {
      if (i < 520) {
        testDb.insert({
          timestamp: oldTs,
          tool: 'codex',
          prompt: `Old unprotected prompt entry ${i} eligible for archive`,
          response: '',
          args: '',
          workdir: '/repo',
          hostname: 'test',
          exit_code: 0,
          metadata: JSON.stringify({ relevance: 5 }),
        });
      } else if (i < 560) {
        testDb.insert({
          timestamp: oldTs,
          tool: 'codex',
          prompt: `Old starred prompt entry ${i} kept by retention policy`,
          response: '',
          args: '',
          workdir: '/repo',
          hostname: 'test',
          exit_code: 0,
          metadata: JSON.stringify({ starred: true, relevance: 5 }),
        });
      } else {
        testDb.insert({
          timestamp: recentTs,
          tool: 'codex',
          prompt: `Recent prompt entry ${i} within retention window`,
          response: '',
          args: '',
          workdir: '/repo',
          hostname: 'test',
          exit_code: 0,
          metadata: JSON.stringify({ relevance: 5 }),
        });
      }
    }

    const searchSpy = vi.spyOn(testDb, 'search');
    const archiveSpy = vi.spyOn(testDb, 'archivePrompts');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await runRetention(testDb, { retentionDays: 90 }, false);

    expect(searchSpy).not.toHaveBeenCalled();
    expect(archiveSpy).toHaveBeenCalledTimes(2);
    expect(archiveSpy.mock.calls[0][0]).toHaveLength(500);
    expect(archiveSpy.mock.calls[1][0]).toHaveLength(20);
    expect(testDb.getPromptCount()).toBe(80);
    expect(testDb.getArchiveStats().total).toBe(520);
  });
});
