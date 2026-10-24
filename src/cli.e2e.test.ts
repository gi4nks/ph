import { afterEach, describe, expect, it } from 'vitest';
import pty from '@lydell/node-pty';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IPtyProcess } from '@lydell/node-pty';

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
});
