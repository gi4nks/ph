import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import { PhDB } from '../db/index.js';
import { captureGitContext } from './git-context.js';
import { createCaptureRecord } from '../capture/index.js';
import { completeLiveCapture, prepareLiveCapture } from '../capture/lifecycle.js';
import type { PhConfig } from '../config/index.js';

export function extractPrompt(args: string[]): string {
  for (let i = args.length - 1; i >= 0; i--) {
    if (!args[i].startsWith('-')) return args[i];
  }
  return args.join(' ');
}

export function resolveRealBinary(tool: string): string {
  let found: string;
  try {
    found = execFileSync('which', [tool], { encoding: 'utf-8' }).trim();
  } catch {
    throw new Error(`command not found: ${tool}`);
  }

  const realFound = fs.realpathSync(found);
  // Detect loop: ph wrapping itself
  const selfPath = fs.realpathSync(process.execPath);
  // process.execPath is node; check if the resolved binary is our own script
  // We compare against argv[1] (the script being run) when in dev mode
  const scriptPath = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
  if (realFound === selfPath || realFound === scriptPath) {
    throw new Error(
      `resolved to ph itself — would loop. Place ph AFTER the real ${tool} in $PATH`
    );
  }
  return realFound;
}

export async function runInline(
  realBin: string,
  args: string[],
  db: PhDB,
  tool: string,
  tags: string[],
  cfg: PhConfig,
  role?: string
): Promise<void> {
  const workdir = process.cwd();
  const gitContext = captureGitContext(workdir);

  const record = prepareLiveCapture(createCaptureRecord({
    tool,
    prompt: extractPrompt(args),
    args: args.join(' '),
    workdir,
    gitContext,
    metadata: { ...(role ? { role } : {}), ...(tags.length > 0 ? { tags } : {}) },
  }), cfg, { inProgress: true });
  const id = db.insert(record);

  const child = spawn(realBin, args, { stdio: ['inherit', 'pipe', 'inherit'] });
  let response = '';
  let spawnError: Error | undefined;
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    process.stdout.write(chunk);
    response += chunk;
  });

  return new Promise(resolve => {
    child.once('error', error => { spawnError = error; });
    child.once('close', async (code, signal) => {
      const exitCode = spawnError ? 1 : (code ?? (signal ? 1 : 0));
      if (spawnError) process.stderr.write(`ph: spawn error: ${spawnError.message}\n`);
      try {
        db.updateResponse(id, response);
        db.updateExitCode(id, exitCode);
      } catch (error) {
        process.stderr.write(`ph: could not persist wrapper response: ${(error as Error).message}\n`);
        process.exitCode = 1;
      }
      await completeLiveCapture(db.dbPath, cfg, id);
      if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = exitCode;
      resolve();
    });
  });
}
