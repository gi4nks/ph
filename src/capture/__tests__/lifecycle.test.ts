import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhDB } from '../../db/index.js';
import type { PhConfig } from '../../config/index.js';
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

  it('schedules automatic memory only when the hub is configured for a supported coding CLI', () => {
    const record = {
      timestamp: new Date().toISOString(), tool: 'codex', prompt: 'Use concise technical answers.',
      response: '', args: '', workdir: '/project', hostname: 'local', exit_code: 0, metadata: '{}',
    };
    const enabled = prepareLiveCapture(record, {
      memoryHubUrl: 'https://memory.example', memoryHubApiKey: 'key',
    });
    expect(JSON.parse(enabled.metadata).automatic_memory_status).toBe('pending');

    const disabled = prepareLiveCapture(record, {
      memoryHubUrl: 'https://memory.example', memoryHubApiKey: 'key', memoryAutoCapture: false,
    });
    expect(JSON.parse(disabled.metadata).automatic_memory_status).toBeUndefined();

    const manual = prepareLiveCapture({ ...record, tool: 'manual' }, {
      memoryHubUrl: 'https://memory.example', memoryHubApiKey: 'key',
    });
    expect(JSON.parse(manual.metadata).automatic_memory_status).toBeUndefined();
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
});
