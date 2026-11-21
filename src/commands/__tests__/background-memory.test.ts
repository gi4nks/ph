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
  };
});

vi.mock('../../ai/provider.js', () => ({
  getProvider: () => ({
    name: 'mock',
    generate: async () => JSON.stringify({
      memories: [
        {
          scope: 'work',
          kind: 'work-preference',
          content: 'Always keep tests isolated per database.',
          evidence: 'Always keep tests isolated',
          sensitive: false,
        },
      ],
    }),
  }),
}));

import { cmdBackgroundMemory } from '../background-memory.js';

describe('cmdBackgroundMemory', () => {
  let dir: string;
  let dbAPath: string;
  let dbBPath: string;
  let dbAId: string;
  let dbBId: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-bg-mem-'));
    dbAPath = path.join(dir, 'a.db');
    dbBPath = path.join(dir, 'b.db');

    const dbA = new PhDB(dbAPath);
    dbAId = dbA.databaseId;
    dbA.insert({
      timestamp: '2026-11-21T10:00:00.000Z',
      tool: 'codex',
      prompt: 'Always keep tests isolated per database.',
      response: 'Got it.',
      args: '',
      workdir: '/project-a',
      hostname: 'host-a',
      exit_code: 0,
      metadata: JSON.stringify({ project: 'ph' }),
    });
    dbA.close();

    const dbB = new PhDB(dbBPath);
    dbBId = dbB.databaseId;
    dbB.insert({
      timestamp: '2026-11-21T10:00:00.000Z',
      tool: 'codex',
      prompt: 'Always keep tests isolated per database.',
      response: 'Got it.',
      args: '',
      workdir: '/project-b',
      hostname: 'host-b',
      exit_code: 0,
      metadata: JSON.stringify({ project: 'ph' }),
    });
    dbB.close();

    configMock.value = {
      memoryHubUrl: 'https://memory.example',
      memoryHubApiKey: 'test-hub-key',
      memoryAutoCapture: true,
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('scopes source_ref and stable memory UUID by databaseId and generates a fresh UUID on --retry', async () => {
    const payloads: Array<{ id: string; source_ref: string; content: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body)) as { id: string; source_ref: string; content: string };
      payloads.push(body);
      return new Response(JSON.stringify({ memory: { id: body.id } }), { status: 201 });
    }));

    await cmdBackgroundMemory(dbAPath, ['1']);
    await cmdBackgroundMemory(dbBPath, ['1']);

    expect(dbAId).not.toBe(dbBId);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]!.source_ref).toBe(`database:${dbAId}:prompt:1:1`);
    expect(payloads[1]!.source_ref).toBe(`database:${dbBId}:prompt:1:1`);
    expect(payloads[0]!.id).not.toBe(payloads[1]!.id);
    expect(payloads[0]!.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(payloads[1]!.id).toMatch(/^[0-9a-f-]{36}$/i);

    await cmdBackgroundMemory(dbAPath, ['1']);
    expect(payloads).toHaveLength(3);
    expect(payloads[2]!.id).toBe(payloads[0]!.id);

    await cmdBackgroundMemory(dbAPath, ['1', '--retry']);
    expect(payloads).toHaveLength(4);
    expect(payloads[3]!.source_ref).toBe(`database:${dbAId}:prompt:1:1`);
    expect(payloads[3]!.id).not.toBe(payloads[0]!.id);
    expect(payloads[3]!.id).toMatch(/^[0-9a-f-]{36}$/i);

    const reopened = new PhDB(dbAPath);
    try {
      const metadata = JSON.parse(reopened.getById(1)!.metadata) as {
        automatic_memory_status?: string;
        automatic_memory_ids?: string[];
      };
      expect(metadata.automatic_memory_status).toBe('complete');
      expect(metadata.automatic_memory_ids).toEqual([payloads[3]!.id]);
    } finally {
      reopened.close();
    }
  });
});
