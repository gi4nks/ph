import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhDB } from '../db/index.js';
import { runInline } from './inline.js';

describe('inline wrapper capture lifecycle', () => {
  const originalExitCode = process.exitCode;
  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('forwards stdout, persists it as the response, and preserves child exit status', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-inline-'));
    const dbPath = path.join(dir, 'history.db');
    const db = new PhDB(dbPath);
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write);

    try {
      await runInline(process.execPath, ['-e', "process.stdout.write('captured response'); process.exit(7)"], db, 'fixture', [], {});
      const row = db.getAllPrompts(1)[0];
      expect(writes.join('')).toBe('captured response');
      expect(row.response).toBe('captured response');
      expect(row.exit_code).toBe(7);
      expect(process.exitCode).toBe(7);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs the wrapped CLI and saves its response when the optional remote URL is invalid', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-inline-invalid-'));
    const db = new PhDB(path.join(dir, 'history.db'));
    const writes: string[] = [];
    vi.stubEnv('PH_REMOTE_URL', '');
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    try {
      await runInline(
        process.execPath,
        ['-e', "process.stdout.write('captured despite invalid remote')"],
        db,
        'fixture',
        [],
        { remoteUrl: 'not a valid URL' },
      );

      const row = db.getAllPrompts(1)[0];
      expect(writes.join('')).toContain('captured despite invalid remote');
      expect(row.response).toBe('captured despite invalid remote');
      expect(JSON.parse(row.metadata)).toMatchObject({
        remote_sync_status: 'failed',
        remote_sync_error: 'invalid_remote_url',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
