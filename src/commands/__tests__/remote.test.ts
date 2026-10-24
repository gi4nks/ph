import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhDB } from '../../db/index.js';

const configMock = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../../config/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  return {
    ...actual,
    load: () => configMock.value,
    save: (next: Record<string, unknown>) => { configMock.value = { ...next }; },
  };
});

import { cmdRemote } from '../remote.js';

describe('remote push cursor (SPEC-019)', () => {
  let dir: string;
  let dbPath: string;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-remote-'));
    dbPath = path.join(dir, 'local.db');
    const db = new PhDB(dbPath);
    const insert = db['db'].prepare(`INSERT INTO prompts
      (timestamp, tool, prompt, response, args, workdir, hostname, exit_code, metadata)
      VALUES (?, 'fixture', 'bulk fixture', '', '', '/p', 'h', 0, '{}')`);
    db['db'].transaction(() => {
      for (let i = 0; i < 500; i++) insert.run('2026-10-24T10:00:00.000Z');
      // This record arrives after the original batch but has an older timestamp.
      insert.run('1999-01-01T00:00:00.000Z');
    })();
    db.close();
    configMock.value = { remoteUrl: 'https://ph.example', remoteApiKey: 'test-key' };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does not checkpoint a partially rejected page and retries late old-timestamp rows', async () => {
    let rejectLateRecord = true;
    const pages: number[][] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: unknown }) => {
      const batch = JSON.parse(String(init?.body)).prompts as Array<{ id: number }>;
      pages.push(batch.map(prompt => prompt.id));
      if (batch[0].id > 500 && rejectLateRecord) {
        return new Response(JSON.stringify({ imported: 0, skipped: 0, errors: ['record rejected'] }), { status: 200 });
      }
      return new Response(JSON.stringify({ imported: batch.length, skipped: 0, errors: [] }), { status: 200 });
    }));

    await cmdRemote(dbPath, ['push']);
    const firstDb = new PhDB(dbPath);
    expect(configMock.value.remotePushCursor).toMatchObject({ id: 500, databaseId: firstDb.databaseId });
    firstDb.close();
    expect(pages.at(-1)).toEqual([501]);
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    rejectLateRecord = false;
    await cmdRemote(dbPath, ['push']);
    expect(configMock.value.remotePushCursor).toMatchObject({ id: 501 });
    expect(pages.at(-1)).toEqual([501]);
  });

  it('pulls every page in remote ID order even when timestamps are identical', async () => {
    const source = Array.from({ length: 501 }, (_, index) => ({
      id: index + 1,
      timestamp: '2026-10-24T10:00:00.000Z',
      tool: 'fixture',
      prompt: `remote fixture ${index + 1}`,
      response: '', args: '', workdir: '/p', hostname: 'remote', exit_code: 0, metadata: '{}',
    }));
    const cursors: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: unknown }) => {
      const request = JSON.parse(String(init?.body)) as { afterId: number; limit: number };
      cursors.push(request.afterId);
      const matches = source.filter(prompt => prompt.id > request.afterId);
      const prompts = matches.slice(0, request.limit);
      return new Response(JSON.stringify({
        prompts,
        hasMore: matches.length > request.limit,
        nextCursor: prompts.at(-1)?.id ?? request.afterId,
      }), { status: 200 });
    }));

    await cmdRemote(dbPath, ['pull']);
    expect(cursors).toEqual([0, 500]);
    expect(configMock.value.remotePullCursor).toMatchObject({ id: 501 });
    const db = new PhDB(dbPath);
    try {
      expect(db.getPromptCount()).toBe(1_002);
      expect(db.getAllPrompts(2_000).filter(row => row.prompt.startsWith('remote fixture '))).toHaveLength(501);
    }
    finally { db.close(); }
  });

  it('restarts push and pull cursors when the local database changes', async () => {
    const first = new PhDB(dbPath);
    const firstDatabaseId = first.databaseId;
    first.close();
    const secondPath = path.join(dir, 'second.db');
    const second = new PhDB(secondPath);
    second.insert({ timestamp: '2026-10-24T11:00:00.000Z', tool: 'fixture', prompt: 'second database row', response: '', args: '', workdir: '/p', hostname: 'h', exit_code: 0, metadata: '{}' });
    const secondDatabaseId = second.databaseId;
    second.close();
    const pushed: string[][] = [];
    const pulledCursors: number[] = [];
    configMock.value = {
      remoteUrl: 'https://ph.example', remoteApiKey: 'test-key',
      remotePushCursor: { target: 'will-be-replaced-below', databaseId: firstDatabaseId, id: 501 },
      remotePullCursor: { target: 'will-be-replaced-below', databaseId: firstDatabaseId, id: 501 },
    };
    // Reuse the canonical target in a cursor created from the first database.
    const { syncTarget } = await import('../../sync/protocol.js');
    (configMock.value.remotePushCursor as Record<string, unknown>).target = syncTarget('https://ph.example');
    (configMock.value.remotePullCursor as Record<string, unknown>).target = syncTarget('https://ph.example');

    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body));
      if (Array.isArray(body.prompts)) {
        pushed.push(body.prompts.map((prompt: { prompt: string }) => prompt.prompt));
        return new Response(JSON.stringify({ imported: body.prompts.length, skipped: 0, errors: [] }), { status: 200 });
      }
      pulledCursors.push(body.afterId);
      return new Response(JSON.stringify({ prompts: [], hasMore: false, nextCursor: body.afterId }), { status: 200 });
    }));

    await cmdRemote(secondPath, ['push']);
    await cmdRemote(secondPath, ['pull']);

    expect(secondDatabaseId).not.toBe(firstDatabaseId);
    expect(pushed[0]).toEqual(['second database row']);
    expect(pulledCursors).toEqual([0]);
    expect(configMock.value.remotePushCursor).toMatchObject({ databaseId: secondDatabaseId, id: 1 });
    expect(configMock.value.remotePullCursor).toMatchObject({ databaseId: secondDatabaseId, id: 0 });
  });

  it('does not bulk-push an active capture or move its cursor past it', async () => {
    const db = new PhDB(dbPath);
    const pendingId = db.insert({
      timestamp: '2026-10-24T11:00:00.000Z', tool: 'fixture', prompt: 'active prompt', response: '', args: '',
      workdir: '/p', hostname: 'h', exit_code: 0,
      metadata: JSON.stringify({ capture_status: 'in_progress', capture_owner_pid: process.pid }),
    });
    db.close();
    const pages: Array<Array<{ id: number; response: string }>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: unknown }) => {
      const batch = JSON.parse(String(init?.body)).prompts as Array<{ id: number; response: string }>;
      pages.push(batch);
      return new Response(JSON.stringify({ imported: batch.length, skipped: 0, errors: [] }), { status: 200 });
    }));

    await cmdRemote(dbPath, ['push']);
    expect(pages.flat().some(row => row.id === pendingId)).toBe(false);
    expect(configMock.value.remotePushCursor).toMatchObject({ id: pendingId - 1 });

    const completed = new PhDB(dbPath);
    completed.updateResponse(pendingId, 'full response');
    completed.updateMetadataFields(pendingId, { capture_status: null, capture_owner_pid: null });
    completed.close();
    await cmdRemote(dbPath, ['push']);

    expect(pages.flat().filter(row => row.id === pendingId).map(row => row.response)).toEqual(['full response']);
  });

  it('reclaims capture markers whose owner process has exited', async () => {
    const db = new PhDB(dbPath);
    const staleId = db.insert({
      timestamp: '2026-10-24T12:00:00.000Z', tool: 'fixture', prompt: 'interrupted capture', response: '', args: '',
      workdir: '/p', hostname: 'h', exit_code: 1,
      metadata: JSON.stringify({ capture_status: 'in_progress', capture_owner_pid: 2_147_483_647 }),
    });
    db.close();
    const sent: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: unknown }) => {
      const batch = JSON.parse(String(init?.body)).prompts as Array<{ id: number }>;
      sent.push(...batch.map(row => row.id));
      return new Response(JSON.stringify({ imported: batch.length, skipped: 0, errors: [] }), { status: 200 });
    }));

    await cmdRemote(dbPath, ['push']);

    const reopened = new PhDB(dbPath);
    try {
      const metadata = JSON.parse(reopened.getById(staleId)!.metadata);
      expect(metadata.capture_status).toBeUndefined();
      expect(metadata.capture_owner_pid).toBeUndefined();
      expect(sent).toContain(staleId);
    } finally {
      reopened.close();
    }
  });
});
