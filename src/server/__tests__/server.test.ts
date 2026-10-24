import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { PhDB } from '../../db/index.js';
import { assertServerConfig, createRequestHandler } from '../index.js';
import type { PhConfig } from '../../config/index.js';
import { syncHash } from '../../utils/syncHash.js';
import { MAX_REQUEST_BODY_BYTES } from '../../sync/protocol.js';

/**
 * GWT wiring for SPEC-010 (remote sync) — the HTTP server exercised over a
 * real socket on an ephemeral port (createRequestHandler, no config file).
 */
describe('ph HTTP server (SPEC-010)', () => {
  let dir: string;
  let db: PhDB;
  let server: http.Server;
  let base: string;
  const cfg: PhConfig = { remoteApiKey: 'test-server-key' };
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer test-server-key' };

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-server-'));
    db = new PhDB(path.join(dir, 'test.db'));
    server = http.createServer(createRequestHandler(db, cfg));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('/health returns ok (SPEC-010 G6-ish)', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
    expect(body.dbPath).toBeUndefined();
  });

  it('POST /api/prompts/search returns matching prompts', async () => {
    db.insert({ timestamp: '2026-08-08T10:00:00.000Z', tool: 'claude', prompt: 'explain goroutines with channels', response: 'r', args: '', workdir: '/p', hostname: 'h', exit_code: 0, metadata: '{}' });
    const res = await fetch(`${base}/api/prompts/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: 'goroutines', limit: 10 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompts).toHaveLength(1);
    expect(body.prompts[0].prompt).toContain('goroutines');
  });

  it('/api/stats returns totals', async () => {
    db.insert({ timestamp: '2026-08-08T10:00:00.000Z', tool: 'claude', prompt: 'some prompt one', response: 'r', args: '', workdir: '/p', hostname: 'h', exit_code: 0, metadata: '{}' });
    db.insert({ timestamp: '2026-08-08T11:00:00.000Z', tool: 'gemini', prompt: 'some prompt two', response: 'r', args: '', workdir: '/p', hostname: 'h', exit_code: 0, metadata: '{}' });
    const res = await fetch(`${base}/api/stats`, { headers });
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.byTool.find((t: { tool: string }) => t.tool === 'claude').count).toBe(1);
  });

  it('sync push dedups by sync_hash (G2)', async () => {
    const prompt = { timestamp: '2026-08-08T10:00:00.000Z', tool: 'claude', prompt: 'a syncable prompt', response: 'resp', args: '', workdir: '/p', hostname: 'h', exit_code: 0, metadata: '{}' };
    const first = await fetch(`${base}/api/sync/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompts: [prompt] }),
    });
    expect((await first.json()).imported).toBe(1);

    const second = await fetch(`${base}/api/sync/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompts: [prompt] }),
    });
    expect(await second.json()).toMatchObject({ imported: 0, skipped: 1 });
  });

  it('sync push stores the sync_hash in metadata', async () => {
    const prompt = { timestamp: '2026-08-08T10:00:00.000Z', tool: 'claude', prompt: 'hashable prompt text', response: 'resp', args: '--verbose', workdir: '/p', hostname: 'h', exit_code: 0, metadata: '{}' };
    await fetch(`${base}/api/sync/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompts: [prompt] }),
    });
    const expected = syncHash(prompt);
    expect(db.getPromptBySyncHash(expected)).toBeDefined();
  });

  it('sync pull pages by stable row id, including equal timestamps', async () => {
    db.insert({ timestamp: '2026-08-08T09:00:00.000Z', tool: 'a', prompt: 'old prompt entry', response: 'r', args: '', workdir: '/p', hostname: 'h', exit_code: 0, metadata: '{}' });
    db.insert({ timestamp: '2026-08-08T12:00:00.000Z', tool: 'a', prompt: 'new prompt entry', response: 'r', args: '', workdir: '/p', hostname: 'h', exit_code: 0, metadata: '{}' });
    db.insert({ timestamp: '2026-08-08T09:00:00.000Z', tool: 'b', prompt: 'old prompt entry two', response: 'r', args: '', workdir: '/p', hostname: 'h', exit_code: 0, metadata: '{}' });
    const res = await fetch(`${base}/api/sync/pull`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ afterId: 0, limit: 1 }),
    });
    const body = await res.json();
    expect(body.prompts).toHaveLength(1);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBe(body.prompts[0].id);
    const next = await fetch(`${base}/api/sync/pull`, { method: 'POST', headers, body: JSON.stringify({ afterId: body.nextCursor, limit: 10 }) });
    const nextPage = await next.json();
    expect(nextPage.prompts).toHaveLength(2);
    expect(nextPage.hasMore).toBe(false);
  });

  it('paginates beyond the former 10,000-row ceiling', async () => {
    const insert = db['db'].prepare(`INSERT INTO prompts
      (timestamp, tool, prompt, response, args, workdir, hostname, exit_code, metadata)
      VALUES (?, 'fixture', 'bulk fixture record', '', '', '/p', 'h', 0, '{}')`);
    db['db'].transaction(() => {
      for (let i = 0; i < 10_001; i++) insert.run('2026-08-08T09:00:00.000Z');
    })();

    let cursor = 0;
    let count = 0;
    let hasMore = true;
    while (hasMore) {
      const response = await fetch(`${base}/api/sync/pull`, {
        method: 'POST', headers,
        body: JSON.stringify({ afterId: cursor, limit: 500 }),
      });
      const page = await response.json();
      count += page.prompts.length;
      hasMore = page.hasMore;
      if (page.prompts.length) cursor = page.nextCursor;
      expect(page.prompts.length).toBeLessThanOrEqual(500);
    }
    expect(count).toBe(10_001);
  }, 30_000);

  it('rejects oversized request bodies and malformed JSON', async () => {
    const tooLarge = await fetch(`${base}/api/prompts/search`, {
      method: 'POST', headers,
      body: JSON.stringify({ query: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1) }),
    });
    expect(tooLarge.status).toBe(413);
    const malformed = await fetch(`${base}/api/prompts/search`, { method: 'POST', headers, body: '{' });
    expect(malformed.status).toBe(400);
  });

  it('rejects missing server credentials at startup', () => {
    expect(() => assertServerConfig({})).toThrow(/remote-api-key/);
    expect(() => assertServerConfig({ remoteApiKey: 'server-key' })).not.toThrow();
  });

  it('unknown routes return 404', async () => {
    const res = await fetch(`${base}/api/nope`, { headers });
    expect(res.status).toBe(404);
  });
});

describe('ph HTTP server auth (SPEC-ISSUES-013)', () => {
  let dir: string;
  let db: PhDB;
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-auth-'));
    db = new PhDB(path.join(dir, 'test.db'));
    server = http.createServer(createRequestHandler(db, { remoteApiKey: 'secret-key' }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('/health stays open without a key', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
  });

  it('rejects API calls without Authorization (401)', async () => {
    const res = await fetch(`${base}/api/stats`);
    expect(res.status).toBe(401);
  });

  it('rejects a wrong key (401)', async () => {
    const res = await fetch(`${base}/api/stats`, { headers: { Authorization: 'Bearer wrong' } });
    expect(res.status).toBe(401);
  });

  it('accepts the configured key (200)', async () => {
    const res = await fetch(`${base}/api/stats`, { headers: { Authorization: 'Bearer secret-key' } });
    expect(res.status).toBe(200);
  });

  it('rejects sync push without auth', async () => {
    const res = await fetch(`${base}/api/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts: [] }),
    });
    expect(res.status).toBe(401);
  });
});
