import { PhDB } from '../db/index.js';
import type { PromptMetadata } from '../types.js';
import { groupIntoSessions, computeSessionCohesion } from '../sessions/index.js';
import { parseFlags } from './_utils.js';

export async function cmdSessions(db: PhDB, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const gapHours = Number(flags['gap-hours'] ?? 2);
  const limit = Number(flags['limit'] ?? 20);
  const minSize = Number(flags['min-size'] ?? 1);
  const noCohesion = Boolean(flags['no-cohesion']);

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

  function fmtDate(ts: string): string {
    const d = new Date(ts);
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${yr}-${mo}-${dy} ${hh}:${mm}`;
  }

  function fmtTime(ts: string): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  const allEntries = db.search({ limit: 100000 });
  const entriesAsc = [...allEntries].reverse();

  const sessions = groupIntoSessions(entriesAsc, gapHours);

  let embeddings: Map<number, Float32Array> | null = null;
  if (!noCohesion) {
    embeddings = db.getAllEmbeddings();
  }

  for (const session of sessions) {
    if (embeddings) {
      session.cohesion = computeSessionCohesion(session, embeddings);
    }
  }

  const filtered = sessions.filter(s => s.entries.length >= minSize);
  const visible = filtered.slice(-limit);

  if (visible.length === 0) {
    process.stdout.write('No sessions found.\n');
    return;
  }

  for (const session of visible) {
    const projectCounts = new Map<string, number>();
    const languageCounts = new Map<string, number>();
    for (const entry of session.entries) {
      let meta: PromptMetadata = {};
      try { meta = JSON.parse(entry.metadata) as PromptMetadata; } catch {}
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

    const startStr = fmtDate(session.startTime.toISOString());
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
      let meta: PromptMetadata = {};
      try { meta = JSON.parse(entry.metadata) as PromptMetadata; } catch {}

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
