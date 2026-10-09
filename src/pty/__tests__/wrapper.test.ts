import { describe, expect, it } from 'vitest';
import pty from '@lydell/node-pty';
import type { IPtyProcess } from '@lydell/node-pty';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PhDB } from '../../db/index.js';
import { stripPtyControlSequences } from '../wrapper.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('PTY response cleanup', () => {
  it('removes terminal color and cursor control sequences while preserving response text', () => {
    expect(stripPtyControlSequences('\u001b[32mReady\u001b[0m\r\n\u001b[2KAnswer: 42'))
      .toBe('Ready\r\nAnswer: 42');
  });

  it('leaves plain text untouched', () => {
    expect(stripPtyControlSequences('plain response\nwith two lines')).toBe('plain response\nwith two lines');
  });

  it('captures an interactive prompt and its ANSI-clean response through the real wrapper PTY', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-pty-'));
    const binDir = path.join(dir, 'bin');
    const dbPath = path.join(dir, 'history.db');
    fs.mkdirSync(binDir);
    const fakeTool = path.join(binDir, 'fakeai');
    fs.writeFileSync(fakeTool, '#!/bin/sh\nprintf "Ready> "\nIFS= read -r answer\nprintf "\\033[32mCaptured: %s\\033[0m\\n" "$answer"\n');
    fs.chmodSync(fakeTool, 0o755);

    let child: IPtyProcess | undefined;
    try {
      const tsxCli = path.join(projectRoot, 'node_modules/tsx/dist/cli.mjs');
      const entry = path.join(projectRoot, 'src/cli.ts');
      child = pty.spawn(process.execPath, [tsxCli, entry, 'fakeai'], {
        cwd: projectRoot,
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, PH_DB: dbPath, TERM: 'xterm-256color' },
        cols: 100,
        rows: 30,
      });
      let output = '';
      child.onData(data => { output += data; });
      const startDeadline = Date.now() + 8000;
      while (!output.includes('Ready>') && Date.now() < startDeadline) await new Promise(resolve => setTimeout(resolve, 20));
      expect(output, 'fake tool did not start').toContain('Ready>');

      const exited = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`wrapper did not exit: ${output}`)), 8000);
        child!.onExit(({ exitCode }) => {
          clearTimeout(timer);
          expect(exitCode).toBe(0);
          resolve();
        });
      });
      child.write('question from outer PTY\r');
      await exited;

      const db = new PhDB(dbPath);
      const [record] = db.getAllPrompts();
      db.close();
      expect(record?.prompt).toBe('question from outer PTY');
      expect(record?.response).toContain('Captured: question from outer PTY');
      expect(record?.response).not.toContain('\u001b[');
    } finally {
      child?.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
