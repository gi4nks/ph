import path from 'path';
import os from 'os';
import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { captureGitContext } from '../runner/git-context.js';
import { createCaptureRecord } from '../capture/index.js';
import { completeLiveCapture, prepareLiveCapture } from '../capture/lifecycle.js';
import { runInline, resolveRealBinary } from '../runner/inline.js';
import { runPTY, isTerminal } from '../pty/wrapper.js';

export async function cmdWrap(dbPath: string, tool: string, args: string[], cfg: PhConfig): Promise<void> {
  let debugLog: string | undefined;
  let role: string | undefined;
  const tags: string[] = [];
  const cleanArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ph-debug') {
      debugLog = path.join(os.homedir(), '.ph_debug.log');
      process.stderr.write(`ph: debug log → ${debugLog}\n`);
    } else if (args[i] === '--ph-tag' && i + 1 < args.length) {
      tags.push(args[i + 1]);
      i++;
    } else if (args[i].startsWith('--ph-tag=')) {
      tags.push(args[i].slice('--ph-tag='.length));
    } else if (args[i] === '--ph-role' && i + 1 < args.length) {
      role = args[i + 1];
      i++;
    } else if (args[i].startsWith('--ph-role=')) {
      role = args[i].slice('--ph-role='.length);
    } else {
      cleanArgs.push(args[i]);
    }
  }

  let realBin: string;
  try {
    realBin = resolveRealBinary(tool);
  } catch (e: unknown) {
    process.stderr.write(`ph: cannot find "${tool}": ${(e as Error).message}\n`);
    process.exit(1);
  }

  const interactive = cleanArgs.length === 0 && isTerminal();

  const db = new PhDB(dbPath);

  if (interactive) {
    const workdir = process.cwd();
    const gitContext = captureGitContext(workdir);
    const completionTasks: Promise<void>[] = [];

    const onPrompt = (prompt: string, ts: Date): number => {
      return db.insert(prepareLiveCapture(createCaptureRecord({
        timestamp: ts.toISOString(),
        tool,
        prompt,
        args: prompt,
        workdir,
        gitContext,
        metadata: { ...(role ? { role } : {}), ...(tags.length > 0 ? { tags } : {}) },
      }), cfg, { inProgress: true }));
    };

    const onResponse = (id: number, response: string) => {
      db.updateResponse(id, response);
      completionTasks.push(completeLiveCapture(dbPath, cfg, id));
    };

    let exitCode: number;
    try {
      exitCode = await runPTY(realBin, cleanArgs, onPrompt, onResponse, debugLog);
      await Promise.all(completionTasks);
    } finally {
      db.close();
    }
    process.exit(exitCode);
  } else {
    try {
      await runInline(realBin, cleanArgs, db, tool, tags, cfg, role);
    } finally {
      db.close();
    }
  }
}
