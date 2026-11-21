import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhDB } from '../../db/index.js';
import type { PhConfig } from '../../config/index.js';

vi.mock('../../background/automatic-memory.js', () => ({
  spawnAutomaticMemoryExtraction: vi.fn(),
}));

import { completeLiveCapture, prepareLiveCapture } from '../lifecycle.js';

describe('shared live capture lifecycle', () => {
  let dbs: PhDB[] = [];
  let dirs: string[] = [];

  afterEach(async () => {
    for (const db of dbs) db.close();
    dbs = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    dirs = [];
  });

  it('recognizes supported coding tools for live capture', () => {
    const record = {
      timestamp: new Date().toISOString(), tool: 'agy', prompt: 'Use concise technical answers.',
      response: '', args: '', workdir: '/project', hostname: 'local', exit_code: 0, metadata: '{}',
    };
    const prepared = prepareLiveCapture(record, {});
    expect(prepared.tool).toBe('agy');
  });

  it('schedules automatic memory only for supported coding tools with hub credentials', () => {
    const base = {
      timestamp: new Date().toISOString(), prompt: 'Always use English in PH docs.', response: 'Understood.',
      args: '', workdir: '/project', hostname: 'local', exit_code: 0, metadata: '{}',
    };
    const cfg: PhConfig = { memoryHubUrl: 'https://memory.example', memoryHubApiKey: 'test-key' };
    const codingCapture = prepareLiveCapture({ ...base, tool: 'codex' }, cfg);
    const otherCapture = prepareLiveCapture({ ...base, tool: 'fixture' }, cfg);
    expect(JSON.parse(codingCapture.metadata).automatic_memory_status).toBe('pending');
    expect(JSON.parse(otherCapture.metadata).automatic_memory_status).toBeUndefined();
  });

  it('marks pending before capture and records remote acknowledgement on completion', async () => {
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-live-local-'));
    dirs.push(localDir);
    const localPath = path.join(localDir, 'local.db');
    const local = new PhDB(localPath);
    dbs.push(local);
    const remoteUrl = 'https://remote.example';
    const cfg: PhConfig = { remoteUrl, remoteApiKey: 'lifecycle-key' };
    const fetchMock = vi.fn(async (_input: string, _init: { body?: unknown }) => new Response(JSON.stringify({ imported: 1, skipped: 0, errors: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const record = prepareLiveCapture({
      timestamp: new Date().toISOString(), tool: 'fixture', prompt: 'lifecycle prompt',
      response: 'lifecycle response', args: '', workdir: '/project', hostname: 'local', exit_code: 0,
      metadata: '{}',
    }, cfg);
    const id = local.insert(record);
    expect(JSON.parse(local.getById(id)!.metadata).remote_sync_status).toBe('pending');

    await completeLiveCapture(localPath, cfg, id);

    expect(JSON.parse(local.getById(id)!.metadata).remote_sync_status).toBe('complete');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).prompts[0].prompt).toBe('lifecycle prompt');
  });

  it('keeps an invalid remote URL from preventing local capture or completion', async () => {
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-live-invalid-'));
    dirs.push(localDir);
    const localPath = path.join(localDir, 'local.db');
    const local = new PhDB(localPath);
    dbs.push(local);
    const cfg: PhConfig = { remoteUrl: 'not a valid URL' };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const record = prepareLiveCapture({
      timestamp: new Date().toISOString(), tool: 'fixture', prompt: 'kept locally',
      response: 'response', args: '', workdir: '/project', hostname: 'local', exit_code: 0, metadata: '{}',
    }, cfg);
    const id = local.insert(record);
    await expect(completeLiveCapture(localPath, cfg, id)).resolves.toBeUndefined();

    const metadata = JSON.parse(local.getById(id)!.metadata);
    expect(metadata.remote_sync_status).toBe('failed');
    expect(metadata.remote_sync_error).toBe('invalid_remote_url');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks wrapper captures as in progress and clears that state after completion', async () => {
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-live-progress-'));
    dirs.push(localDir);
    const localPath = path.join(localDir, 'local.db');
    const local = new PhDB(localPath);
    dbs.push(local);
    const cfg: PhConfig = { remoteUrl: 'https://remote.example', remoteApiKey: 'lifecycle-key' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ imported: 1, skipped: 0, errors: [] }), { status: 200 })));

    const record = prepareLiveCapture({
      timestamp: new Date().toISOString(), tool: 'fixture', prompt: 'in progress',
      response: '', args: '', workdir: '/project', hostname: 'local', exit_code: 0, metadata: '{}',
    }, cfg, { inProgress: true });
    const id = local.insert(record);
    expect(JSON.parse(local.getById(id)!.metadata).capture_status).toBe('in_progress');

    local.updateResponse(id, 'finished response');
    await completeLiveCapture(localPath, cfg, id);

    const metadata = JSON.parse(local.getById(id)!.metadata);
    expect(metadata.capture_status).toBeUndefined();
    expect(metadata.capture_owner_pid).toBeUndefined();
  });

  it('strips automatic_memory_* fields from remote sync payloads when both hub and remote sync are configured', async () => {
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-live-strip-'));
    dirs.push(localDir);
    const localPath = path.join(localDir, 'local.db');
    const local = new PhDB(localPath);
    dbs.push(local);

    const cfg: PhConfig = {
      remoteUrl: 'https://remote.example',
      remoteApiKey: 'lifecycle-key',
      memoryHubUrl: 'https://memory.example',
      memoryHubApiKey: 'hub-key',
    };
    const fetchMock = vi.fn(async (_input: string, _init: { body?: unknown }) =>
      new Response(JSON.stringify({ imported: 1, skipped: 0, errors: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const record = prepareLiveCapture({
      timestamp: new Date().toISOString(),
      tool: 'codex',
      prompt: 'Always keep tests isolated.',
      response: 'Noted.',
      args: '',
      workdir: '/project',
      hostname: 'local',
      exit_code: 0,
      metadata: JSON.stringify({ project: 'ph' }),
    }, cfg);
    const id = local.insert(record);
    local.updateMetadataFields(id, {
      automatic_memory_error: 'save_failed',
      automatic_memory_ids: ['11111111-1111-4111-8111-111111111111'],
    });

    await completeLiveCapture(localPath, cfg, id);

    expect(fetchMock).toHaveBeenCalledOnce();
    const sentPrompt = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).prompts[0] as { metadata: string };
    const sentMeta = JSON.parse(sentPrompt.metadata) as Record<string, unknown>;
    expect(sentMeta.project).toBe('ph');
    expect(sentMeta.automatic_memory_status).toBeUndefined();
    expect(sentMeta.automatic_memory_error).toBeUndefined();
    expect(sentMeta.automatic_memory_ids).toBeUndefined();

    const localMeta = JSON.parse(local.getById(id)!.metadata) as Record<string, unknown>;
    expect(localMeta.automatic_memory_status).toBe('pending');
    expect(localMeta.automatic_memory_error).toBe('save_failed');
    expect(localMeta.automatic_memory_ids).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(localMeta.remote_sync_status).toBe('complete');
  });
});
