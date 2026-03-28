import type { PromptEntry, PromptMetadata } from '../types.js';

const C = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

function truncatePrompt(s: string, max = 120): string {
  const flat = s.replace(/\n/g, ' ');
  if (flat.length > max) return flat.slice(0, max) + '\u2026';
  return flat;
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    );
  } catch {
    return ts;
  }
}

export function printResults(entries: PromptEntry[], showFull: boolean): void {
  if (entries.length === 0) {
    console.log('No results found.');
    return;
  }

  console.log(`${C.yellow}${entries.length} result(s)${C.reset}\n`);

  for (const e of entries) {
    printEntry(e, showFull);
  }
}

export function printEntry(e: PromptEntry, showFull: boolean): void {
  let meta: PromptMetadata = {};
  try {
    meta = JSON.parse(e.metadata) as PromptMetadata;
  } catch (_) {}

  const exitColor = e.exit_code === 0 ? C.green : C.red;

  const starStr = meta.starred ? `${C.yellow}★${C.reset} ` : '';

  let projectStr = '';
  if (meta.project && meta.language) {
    projectStr = `${C.blue}[${meta.project}:${meta.language}]${C.reset} `;
  } else if (meta.project) {
    projectStr = `${C.blue}[${meta.project}]${C.reset} `;
  } else if (meta.language) {
    projectStr = `${C.blue}[${meta.language}]${C.reset} `;
  }

  const roleStr = meta.role ? `${C.magenta}{${meta.role}}${C.reset} ` : '';

  let tagsStr = '';
  if (meta.tags && meta.tags.length > 0) {
    tagsStr = `${C.cyan}(${meta.tags.join(',')})${C.reset} `;
  }

  // Header line: #5  ★ claude  2026-01-15 10:23:45  [myproject:go] {debug} (api,auth)  [exit:0]
  process.stdout.write(
    `${C.cyan}#${String(e.id).padEnd(4)}${C.reset}  ` +
      `${starStr}` +
      `${C.yellow}${e.tool.padEnd(8)}${C.reset}  ` +
      `${C.gray}${formatTimestamp(e.timestamp)}${C.reset}  ` +
      `${projectStr}${roleStr}${tagsStr}` +
      `${exitColor}[exit:${e.exit_code}]${C.reset}\n`
  );

  // Working dir
  if (e.workdir) {
    process.stdout.write(`       ${C.gray}${e.workdir}${C.reset}\n`);
  }

  // Prompt text
  let prompt = e.prompt;
  if (!showFull) {
    prompt = truncatePrompt(prompt);
  }
  // Indent multiline prompts
  prompt = prompt.replace(/\n/g, '\n       ');
  process.stdout.write(`       ${prompt}\n\n`);
}
