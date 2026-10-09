import { PhDB } from '../db/index.js';
import type { PromptMetadata } from '../types.js';
import { groupIntoSessions, computeSessionCohesion } from '../sessions/index.js';
import { parseFlags } from './_utils.js';

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}`;
}

function fmtTime(ts: string): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function parseMeta(raw: string): PromptMetadata {
  try { return JSON.parse(raw) as PromptMetadata; } catch { return {}; }
}

function exportSessionMarkdown(session: { index: number; startTime: Date; endTime: Date; entries: import('../types.js').PromptEntry[] }): string {
  const lines: string[] = [];
  const dateStr = formatTimestamp(session.startTime.toISOString());
  const endStr = fmtTime(session.endTime.toISOString());

  lines.push(`# Session ${session.index} — ${dateStr} → ${endStr}`);
  lines.push('');
  lines.push(`**${session.entries.length} prompts**`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const entry of session.entries) {
    const meta = parseMeta(entry.metadata);
    const ts = formatTimestamp(entry.timestamp);
    const title = meta.title || entry.prompt.replace(/\n/g, ' ').slice(0, 60);

    lines.push(`## #${entry.id} — ${entry.tool} — ${ts}`);
    if (title) lines.push(`**${title}**`);
    lines.push('');

    const metaLine: string[] = [];
    if (meta.role) metaLine.push(`Role: ${meta.role}`);
    if (meta.project) metaLine.push(`Project: ${meta.project}`);
    if (meta.language) metaLine.push(`Language: ${meta.language}`);
    if (meta.tags?.length) metaLine.push(`Tags: ${meta.tags.join(', ')}`);
    if (meta.relevance !== undefined) metaLine.push(`Relevance: ${meta.relevance}/10`);
    if (meta.quality !== undefined) metaLine.push(`Quality: ${meta.quality}/10`);
    if (metaLine.length > 0) {
      lines.push(metaLine.join(' · '));
      lines.push('');
    }

    if (meta.summary) {
      lines.push(`> ${meta.summary}`);
      lines.push('');
    }

    lines.push('### Prompt');
    lines.push('');
    lines.push('```');
    lines.push(entry.prompt);
    lines.push('```');
    lines.push('');

    if (entry.response) {
      lines.push('### Response');
      lines.push('');
      lines.push('```');
      lines.push(entry.response.slice(0, 2000));
      lines.push('```');
      lines.push('');
    }

    if (meta.key_insights?.length) {
      lines.push('**Insights:**');
      for (const ins of meta.key_insights) lines.push(`- ${ins}`);
      lines.push('');
    }

    if (meta.git_context) {
      lines.push(`*Git: ${meta.git_context.branch}, ${meta.git_context.files?.length || 0} files modified*`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

export async function cmdSessions(db: PhDB, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const gapHours = Number(flags['gap-hours'] ?? 2);
  const limit = Number(flags['limit'] ?? 20);
  const minSize = Number(flags['min-size'] ?? 1);
  const noCohesion = Boolean(flags['no-cohesion']);
  const exportIndex = flags['export'] !== undefined ? Number(flags['export']) : undefined;

  const allEntries = db.search({ limit: 100000 });
  const entriesAsc = [...allEntries].reverse();

  const sessions = groupIntoSessions(entriesAsc, gapHours);

  let embeddings: Map<number, Float32Array> | null = null;
  if (!noCohesion && exportIndex === undefined) {
    embeddings = db.getAllEmbeddings();
  }

  for (const session of sessions) {
    if (embeddings) {
      session.cohesion = computeSessionCohesion(session, embeddings);
    }
  }

  // Export mode: output a single session as markdown
  if (exportIndex !== undefined) {
    const session = sessions.find(s => s.index === exportIndex);
    if (!session) {
      process.stderr.write(`Session ${exportIndex} not found.\n`);
      return;
    }
    process.stdout.write(exportSessionMarkdown(session));
    return;
  }

  const filtered = sessions.filter(s => s.entries.length >= minSize);
  const visible = filtered.slice(-limit);

  if (visible.length === 0) {
    process.stdout.write('No sessions found.\n');
    return;
  }

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

  for (const session of visible) {
    const projectCounts = new Map<string, number>();
    const languageCounts = new Map<string, number>();
    for (const entry of session.entries) {
      const meta = parseMeta(entry.metadata);
      if (meta.project) projectCounts.set(meta.project, (projectCounts.get(meta.project) ?? 0) + 1);
      if (meta.language) languageCounts.set(meta.language, (languageCounts.get(meta.language) ?? 0) + 1);
    }

    const total = session.entries.length;
    let dominantProject: string | null = null;
    let dominantLanguage: string | null = null;

    for (const [proj, count] of projectCounts) {
      if (count / total > 0.5) { dominantProject = proj; break; }
    }
    for (const [lang, count] of languageCounts) {
      if (count / total > 0.5) { dominantLanguage = lang; break; }
    }

    const startStr = formatTimestamp(session.startTime.toISOString());
    const endStr = fmtTime(session.endTime.toISOString());
    const promptWord = session.entries.length === 1 ? 'prompt' : 'prompts';

    let header = `${C.cyan}Session ${session.index}${C.reset}`;
    header += `  ${C.gray}·${C.reset}  ${startStr}  →  ${endStr}`;
    header += `  ${C.gray}·${C.reset}  ${C.yellow}${session.entries.length} ${promptWord}${C.reset}`;

    if (dominantProject && dominantLanguage) {
      header += `  ${C.gray}·  [${dominantProject}:${dominantLanguage}]${C.reset}`;
    } else if (dominantProject) {
      header += `  ${C.gray}·  [${dominantProject}]${C.reset}`;
    } else if (dominantLanguage) {
      header += `  ${C.gray}·  [${dominantLanguage}]${C.reset}`;
    }

    if (session.cohesion !== null) {
      header += `  ${C.gray}·  cohesion: ${session.cohesion.toFixed(2)}${C.reset}`;
    }

    process.stdout.write(header + '\n');

    for (const entry of session.entries) {
      const meta = parseMeta(entry.metadata);

      const idStr = `${C.cyan}#${entry.id}${C.reset}`;
      const toolStr = `${C.yellow}${entry.tool.padEnd(8)}${C.reset}`;
      const timeStr = `${C.gray}${fmtTime(entry.timestamp)}${C.reset}`;

      let rolePart = '';
      if (meta.role) rolePart = `  ${C.magenta}{${meta.role}}${C.reset}`;

      let tagsPart = '';
      if (meta.tags && meta.tags.length > 0) tagsPart = `  ${C.cyan}(${meta.tags.join(', ')})${C.reset}`;

      const preview = entry.prompt.replace(/\n/g, ' ').slice(0, 80);

      process.stdout.write(`  ${idStr}  ${toolStr}  ${timeStr}${rolePart}${tagsPart}  ${preview}\n`);
    }

    process.stdout.write('\n');
  }
}
