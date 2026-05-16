import path from 'path';
import os from 'os';
import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { detectProject, detectLanguage } from '../runner/project.js';
import { captureGitContext } from '../runner/git-context.js';
import { runInline, resolveRealBinary } from '../runner/inline.js';
import { runPTY, isTerminal } from '../pty/wrapper.js';
import { spawnBackgroundAnalysis } from '../background/analyzer.js';

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
    const { rootDir, projectName } = detectProject(workdir);
    const language = detectLanguage(rootDir);
    const gitContext = captureGitContext(workdir);

    const onPrompt = (prompt: string, ts: Date): number => {
      const metaObj: Record<string, unknown> = { $schema_version: 1 };
      if (projectName) metaObj.project = projectName;
      if (language) metaObj.language = language;
      if (role) metaObj.role = role;
      if (tags.length > 0) metaObj.tags = tags;
      if (gitContext) metaObj.git_context = gitContext;
      const metadata = Object.keys(metaObj).length > 0 ? JSON.stringify(metaObj) : '{}';

      return db.insert({
        timestamp: ts.toISOString(),
        tool,
        prompt,
        response: '',
        args: prompt,
        workdir,
        hostname: os.hostname(),
        exit_code: 0,
        metadata,
      });
    };

    const onResponse = (id: number, response: string) => {
      if (!response.trim()) return;
      db.updateResponse(id, response);
      if (cfg.backgroundAnalysis) {
        spawnBackgroundAnalysis(id, dbPath);
      }
    };

    const exitCode = await runPTY(realBin!, cleanArgs, onPrompt, onResponse, debugLog);
    db.close();
    process.exit(exitCode);
  } else {
    await runInline(realBin!, cleanArgs, db, tool, tags, role, (id) => {
      if (cfg.backgroundAnalysis) {
        spawnBackgroundAnalysis(id, dbPath);
      }
    });
  }
}
