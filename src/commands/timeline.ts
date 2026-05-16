import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import type { PromptEntry, PromptMetadata, MemoryEntry } from '../types.js';
import { detectProject } from '../runner/project.js';
import { parseFlags } from './_utils.js';

interface TimelineEvent {
  type: 'prompt' | 'memory';
  timestamp: string;
  prompt?: PromptEntry;
  memory?: MemoryEntry;
}

export async function cmdTimeline(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const project = (flags['project'] as string) || positional.join(' ') || detectProject(process.cwd()).projectName;

  if (!project) {
    process.stderr.write('ph: could not detect project. Use --project <name> or pass a project name.\n');
    process.exit(1);
  }

  const prompts = db.getAllPromptsByProject(project);
  const memories = db.getAllMemoriesByProject(project);

  if (prompts.length === 0 && memories.length === 0) {
    process.stdout.write(`No history found for project "${project}".\n`);
    return;
  }

  const output: string[] = [];

  output.push(`# Timeline: ${project}\n`);
  output.push(`**${prompts.length} prompts** · **${memories.length} memory entries**\n`);

  const events: TimelineEvent[] = [
    ...prompts.map(p => ({ type: 'prompt' as const, timestamp: p.timestamp, prompt: p })),
    ...memories.map(m => ({ type: 'memory' as const, timestamp: m.created_at, memory: m })),
  ];
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let currentDate = '';

  for (const event of events) {
    const date = new Date(event.timestamp).toLocaleDateString('en-CA'); // YYYY-MM-DD
    if (date !== currentDate) {
      currentDate = date;
      output.push(`\n## ${date}\n`);
    }

    if (event.type === 'prompt' && event.prompt) {
      output.push(formatPromptEntry(event.prompt));
    }

    if (event.type === 'memory' && event.memory) {
      output.push(formatMemoryEntry(event.memory));
    }
  }

  process.stdout.write(output.join('\n'));
}

function formatPromptEntry(e: PromptEntry): string {
  let meta: PromptMetadata = {};
  try { meta = JSON.parse(e.metadata); } catch {}

  const time = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const lines: string[] = [];
  lines.push(`### #${e.id} — ${e.tool} — ${time}`);
  if (meta.role) lines.push(`**Role**: ${meta.role}`);
  if (meta.title) lines.push(`**Title**: ${meta.title}`);
  if (meta.tags?.length) lines.push(`**Tags**: ${meta.tags.join(', ')}`);
  if (meta.summary) lines.push(`**Summary**: ${meta.summary}`);
  if (meta.relevance !== undefined) lines.push(`**Relevance**: ${meta.relevance}/10`);
  lines.push('');
  lines.push('**Prompt**:');
  lines.push('```');
  lines.push(e.prompt.slice(0, 500) + (e.prompt.length > 500 ? '\n...' : ''));
  lines.push('```');
  if (e.response) {
    lines.push('');
    lines.push('**Response**:');
    lines.push('```');
    lines.push(e.response.slice(0, 300) + (e.response.length > 300 ? '\n...' : ''));
    lines.push('```');
  }
  if (meta.key_insights?.length) {
    lines.push('');
    lines.push('**Insights**:');
    for (const i of meta.key_insights) lines.push(`- ${i}`);
  }
  lines.push('---\n');
  return lines.join('\n');
}

function formatMemoryEntry(m: MemoryEntry): string {
  const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const lines: string[] = [];
  lines.push(`> 📌 **Memory #${m.id} — ${time}**`);
  if (m.prompt_ids.length > 0) {
    lines.push(`> _Derived from prompts: #${m.prompt_ids.join(', #')}_`);
  }
  if (m.summary) lines.push(`> **Summary**: ${m.summary}`);
  if (m.key_insights.length > 0) {
    lines.push(`> **Insights**:`);
    for (const i of m.key_insights) lines.push(`> - ${i}`);
  }
  if (m.technical_decisions.length > 0) {
    lines.push(`> **Technical Decisions**:`);
    for (const d of m.technical_decisions) lines.push(`> - ${d}`);
  }
  lines.push('---\n');
  return lines.join('\n');
}
