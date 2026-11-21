import { afterEach, describe, expect, it } from 'vitest';
import pty from '@lydell/node-pty';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IPtyProcess } from '@lydell/node-pty';
import { PhDB } from './db/index.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('plain-text CLI entry', () => {
  let child: IPtyProcess | undefined;

  afterEach(() => {
    child?.kill();
    child = undefined;
  });

  it('prints the concise guide in a terminal and exits without opening a UI', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-cli-'));
    try {
      const tsxCli = path.join(projectRoot, 'node_modules/tsx/dist/cli.mjs');
      const entry = path.join(projectRoot, 'src/cli.ts');
      child = pty.spawn(process.execPath, [tsxCli, entry], {
        cwd: projectRoot,
        env: { ...process.env, HOME: home, PH_DB: path.join(home, 'ph.db'), TERM: 'xterm-256color' },
        cols: 100,
        rows: 30,
      });

      let output = '';
      child.onData(data => { output += data; });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('CLI guide did not exit')), 8000);
        child!.onExit(({ exitCode }) => {
          clearTimeout(timer);
          expect(exitCode).toBe(0);
          resolve();
        });
      });

      expect(output).toContain('One-time setup');
      expect(output).toContain('ph setup');
      expect(output).toContain('use those tools normally');
      expect(output).toContain('ph search "query"');
      expect(output).toContain('ph help --all');
      expect(output).not.toContain('\u001b[?1049h');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }, 12000);

  it('forwards --force to cmdEmbedAll so stored vectors are cleared before re-embedding', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-cli-embed-'));
    const dbPath = path.join(home, 'ph.db');
    try {
      const db = new PhDB(dbPath);
      const id = db.insert({
        timestamp: '2026-10-09T10:00:00.000Z',
        tool: 'codex',
        prompt: 'Test vector rebuild flag forwarding',
        response: 'Test response',
        args: '',
        workdir: home,
        hostname: 'test',
        exit_code: 0,
        metadata: '{}',
      });
      db.saveEmbedding(id, new Float32Array(768), 'old-embed-model');
      db.close();

      const tsxCli = path.join(projectRoot, 'node_modules/tsx/dist/cli.mjs');
      const entry = path.join(projectRoot, 'src/cli.ts');
      const res = spawnSync(process.execPath, [tsxCli, entry, 'embed-all', '--force'], {
        cwd: projectRoot,
        env: { ...process.env, HOME: home, PH_DB: dbPath },
        encoding: 'utf8',
      });

      expect(res.stdout).toContain('Clearing 1 existing vectors (old-embed-model)');

      const reopened = new PhDB(dbPath);
      expect(reopened.getEmbeddingCount()).toBe(0);
      expect(reopened.getEmbeddingModel()).toBeNull();
      reopened.close();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }, 12000);
});
