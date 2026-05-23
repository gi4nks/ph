import fs from 'fs';
import path from 'path';

const PROJECT_MARKERS = [
  '.git',
  'go.mod',
  'package.json',
  'Cargo.toml',
  'Makefile',
  'pyproject.toml',
  'requirements.txt',
];

const LANGUAGE_MAP: Record<string, string> = {
  'go.mod': 'go',
  'package.json': 'javascript',
  'Cargo.toml': 'rust',
  'pyproject.toml': 'python',
  'requirements.txt': 'python',
  'Makefile': 'make',
  'composer.json': 'php',
  'Gemfile': 'ruby',
};

export function detectProject(startDir: string): { rootDir: string; projectName: string } {
  let curr = path.resolve(startDir);
  while (true) {
    for (const marker of PROJECT_MARKERS) {
      if (fs.existsSync(path.join(curr, marker))) {
        return { rootDir: curr, projectName: path.basename(curr) };
      }
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return { rootDir: '', projectName: '' };
}

export function detectLanguage(rootDir: string): string {
  if (!rootDir) return '';
  for (const [marker, lang] of Object.entries(LANGUAGE_MAP)) {
    if (fs.existsSync(path.join(rootDir, marker))) return lang;
  }
  return '';
}
