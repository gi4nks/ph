import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import { PhDB } from '../db/index.js';
import { detectProject, detectLanguage } from './project.js';
import { captureGitContext } from './git-context.js';

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
  role?: string,
  onInserted?: (id: number) => void
): Promise<void> {
  const workdir = process.cwd();
  const { rootDir, projectName } = detectProject(workdir);
  const language = detectLanguage(rootDir);
  const gitContext = captureGitContext(workdir);

  const metaObj: Record<string, unknown> = {};
  if (projectName) metaObj.project = projectName;
  if (language) metaObj.language = language;
  if (role) metaObj.role = role;
  if (tags.length > 0) metaObj.tags = tags;
  if (gitContext) metaObj.git_context = gitContext;
  const metadata = Object.keys(metaObj).length > 0 ? JSON.stringify(metaObj) : '{}';

  const id = db.insert({
    timestamp: new Date().toISOString(),
    tool,
    prompt: extractPrompt(args),
    args: args.join(' '),
    workdir,
    hostname: os.hostname(),
    exit_code: 0,
    metadata,
  });

  if (onInserted) onInserted(id);

  const child = spawn(realBin, args, { stdio: 'inherit' });

  child.on('error', (err) => {
    process.stderr.write(`ph: spawn error: ${err.message}\n`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    const exitCode = code ?? (signal ? 1 : 0);
    if (id > 0) db.updateExitCode(id, exitCode);
    process.exit(exitCode);
  });
}
