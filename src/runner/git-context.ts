import { execFileSync } from 'child_process';

export interface GitContext {
  branch: string;
  files: string[];
  diff: string;
}

export function captureGitContext(workdir: string): GitContext | null {
  try {
    const branch = execFileSync('git', ['-C', workdir, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    const filesRaw = execFileSync('git', ['-C', workdir, 'diff', '--name-only', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const files = filesRaw ? filesRaw.split('\n').filter(Boolean) : [];

    let diff = execFileSync('git', ['-C', workdir, 'diff', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (diff.length > 4000) {
      diff = diff.slice(0, 4000) + '\n... (truncated)';
    }

    return { branch, files, diff };
  } catch {
    return null;
  }
}
