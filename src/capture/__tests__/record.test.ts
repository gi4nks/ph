import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCaptureRecord } from '../index.js';

describe('createCaptureRecord', () => {
  let root: string | undefined;
  afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

  it('normalizes project metadata and keeps source-specific capture fields', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-capture-'));
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}');

    const record = createCaptureRecord({
      tool: 'claude', prompt: 'Explain SQLite migrations', response: 'Use additive changes.',
      args: 'claude --print', workdir: root, exit_code: 2, timestamp: '2026-10-01T10:00:00.000Z',
      metadata: { role: 'architect', tags: ['database'] },
      gitContext: { branch: 'main', files: ['src/db.ts'], diff: '+ migration' },
    });
    const metadata = JSON.parse(record.metadata) as Record<string, unknown>;

    expect(record).toMatchObject({ tool: 'claude', prompt: 'Explain SQLite migrations', response: 'Use additive changes.', args: 'claude --print', exit_code: 2 });
    expect(metadata).toMatchObject({
      $schema_version: 1, project: path.basename(root), language: 'javascript',
      title: 'Explain SQLite migrations', role: 'architect', tags: ['database'],
      git_context: { branch: 'main', files: ['src/db.ts'], diff: '+ migration' },
    });
  });
});
