import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { groupIntoSessions } from '../index.js';
import { PhDB } from '../../db/index.js';
import { cmdSessions } from '../../commands/sessions.js';
import type { PromptEntry } from '../../types.js';

/**
 * GWT wiring for SPEC-014 (sessions) — time-gap splitting, no cohesion needed.
 */
function entry(timestamp: string): PromptEntry {
  return {
    id: Math.floor(Math.random() * 1e6),
    timestamp,
    tool: 'claude',
    prompt: 'some prompt text of sufficient length',
    response: '',
    args: '',
    workdir: '/p',
    hostname: 'h',
    exit_code: 0,
    metadata: '{}',
  };
}

describe('groupIntoSessions (SPEC-014)', () => {
  it('splits sessions on gaps larger than gapHours (G1)', () => {
    const sessions = groupIntoSessions([
      entry('2026-08-08T10:00:00.000Z'),
      entry('2026-08-08T13:30:00.000Z'), // 3.5h gap > 2h
    ], 2);
    expect(sessions).toHaveLength(2);
  });

  it('keeps prompts within the gap window in one session (G2)', () => {
    const sessions = groupIntoSessions([
      entry('2026-08-08T10:00:00.000Z'),
      entry('2026-08-08T11:30:00.000Z'), // 1.5h gap < 2h
    ], 2);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].entries).toHaveLength(2);
  });

  it('groups multiple prompts into their sessions', () => {
    const sessions = groupIntoSessions([
      entry('2026-08-08T09:00:00.000Z'),
      entry('2026-08-08T09:30:00.000Z'),
      entry('2026-08-08T15:00:00.000Z'),
      entry('2026-08-08T15:20:00.000Z'),
    ], 2);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].entries).toHaveLength(2);
    expect(sessions[1].entries).toHaveLength(2);
  });

  it('handles an empty list', () => {
    expect(groupIntoSessions([], 2)).toEqual([]);
  });

  it('handles a single prompt', () => {
    const sessions = groupIntoSessions([entry('2026-08-08T10:00:00.000Z')], 2);
    expect(sessions).toHaveLength(1);
  });
});

describe('cmdSessions --days and bounded embedding lookup (A-03)', () => {
  let root = '';
  let db: PhDB | undefined;
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    db?.close();
    db = undefined;
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function createDb(): PhDB {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-sessions-test-'));
    db = new PhDB(path.join(root, 'history.db'));
    return db;
  }

  it('supports --days filter, avoids getAllEmbeddings, and queries getEmbeddingsByIds only for visible sessions', async () => {
    const testDb = createDb();
    const now = Date.now();

    // Session 1 (older than 10 days, hidden by --days 7)
    const old1 = testDb.insert({
      timestamp: new Date(now - 12 * 86_400_000).toISOString(),
      tool: 'claude',
      prompt: 'Old session prompt beyond days window',
      response: '',
      args: '',
      workdir: '/repo',
      hostname: 'test',
      exit_code: 0,
      metadata: '{}',
    });
    testDb.saveEmbedding(old1, new Float32Array([1, 0, 0]));

    // Session 2 (5 days ago, within --days 7, hidden by --limit 1)
    const mid1 = testDb.insert({
      timestamp: new Date(now - 5 * 86_400_000).toISOString(),
      tool: 'claude',
      prompt: 'Earlier recent session first prompt',
      response: '',
      args: '',
      workdir: '/repo',
      hostname: 'test',
      exit_code: 0,
      metadata: '{}',
    });
    const mid2 = testDb.insert({
      timestamp: new Date(now - 5 * 86_400_000 + 10 * 60_000).toISOString(),
      tool: 'claude',
      prompt: 'Earlier recent session second prompt',
      response: '',
      args: '',
      workdir: '/repo',
      hostname: 'test',
      exit_code: 0,
      metadata: '{}',
    });
    testDb.saveEmbedding(mid1, new Float32Array([0, 1, 0]));
    testDb.saveEmbedding(mid2, new Float32Array([0, 1, 0]));

    // Session 3 (1 hour ago, visible with --limit 1)
    const vis1 = testDb.insert({
      timestamp: new Date(now - 60 * 60_000).toISOString(),
      tool: 'codex',
      prompt: 'Visible session prompt one',
      response: '',
      args: '',
      workdir: '/repo',
      hostname: 'test',
      exit_code: 0,
      metadata: '{}',
    });
    const vis2 = testDb.insert({
      timestamp: new Date(now - 45 * 60_000).toISOString(),
      tool: 'codex',
      prompt: 'Visible session prompt two',
      response: '',
      args: '',
      workdir: '/repo',
      hostname: 'test',
      exit_code: 0,
      metadata: '{}',
    });
    testDb.saveEmbedding(vis1, new Float32Array([1, 0, 0]));
    testDb.saveEmbedding(vis2, new Float32Array([1, 0, 0]));

    const searchSpy = vi.spyOn(testDb, 'search');
    const getAllEmbeddingsSpy = vi.spyOn(testDb, 'getAllEmbeddings');
    const getEmbeddingsByIdsSpy = vi.spyOn(testDb, 'getEmbeddingsByIds');
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await cmdSessions(testDb, ['--days', '7', '--limit', '1']);

    expect(searchSpy).toHaveBeenCalledTimes(1);
    const searchOpts = searchSpy.mock.calls[0][0];
    expect(searchOpts.limit).toBe(1000);
    expect(searchOpts.since).toBeInstanceOf(Date);

    expect(getAllEmbeddingsSpy).not.toHaveBeenCalled();
    expect(getEmbeddingsByIdsSpy).toHaveBeenCalledTimes(1);
    expect(getEmbeddingsByIdsSpy.mock.calls[0][0].sort((a, b) => a - b)).toEqual([vis1, vis2]);

    const output = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('Visible session prompt one');
    expect(output).toContain('cohesion: 1.00');
    expect(output).not.toContain('Earlier recent session');
    expect(output).not.toContain('Old session prompt');
    expect(process.exitCode).toBeUndefined();
  });

  it('rejects invalid --days values with exitCode 1', async () => {
    const testDb = createDb();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await cmdSessions(testDb, ['--days', '0']);
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('--days'));

    process.exitCode = undefined;
    await cmdSessions(testDb, ['--days']);
    expect(process.exitCode).toBe(1);
  });
});
