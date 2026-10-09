import { afterEach, describe, expect, it } from 'vitest';
import pty from '@lydell/node-pty';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IPtyProcess } from '@lydell/node-pty';
import { PhDB } from '../../db/index.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('ph browse TUI (PTY smoke)', () => {
  let child: IPtyProcess | undefined;

  afterEach(() => {
    child?.kill();
    child = undefined;
  });

  it('opens the filter panel from the browser and exits cleanly', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-browse-'));
    const dbPath = path.join(dir, 'browse.db');
    const db = new PhDB(dbPath);
    db.insert({ timestamp: new Date().toISOString(), tool: 'claude', prompt: 'browse fixture prompt', response: 'fixture response', args: '', workdir: '/project', hostname: 'test', exit_code: 0, metadata: JSON.stringify({ project: 'fixture' }) });
    db.close();

    try {
      const tsxCli = path.join(projectRoot, 'node_modules/tsx/dist/cli.mjs');
      const entry = path.join(projectRoot, 'src/cli.ts');
      child = pty.spawn(process.execPath, [tsxCli, entry, 'browse'], {
        cwd: projectRoot,
        env: { ...process.env, PH_DB: dbPath, TERM: 'xterm-256color' },
        cols: 100,
        rows: 30,
      });

      let output = '';
      child.onData(data => { output += data; });
      const awaitText = async (text: string) => {
        const deadline = Date.now() + 8000;
        while (!output.includes(text) && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        expect(output).toContain(text);
      };
      await awaitText('Browse fixture prompt');

      child.write('f');
      await awaitText('Filters');
      const exited = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('TUI did not exit after q')), 8000);
        child!.onExit(({ exitCode }) => {
          clearTimeout(timer);
          expect(exitCode).toBe(0);
          resolve();
        });
      });
      child.write('\u001b');
      await new Promise(resolve => setTimeout(resolve, 100));
      child.write('q');
      await exited;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
