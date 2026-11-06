import type { PhDB } from '../db/index.js';
import type { MemoryEntry, MemoryKind, MemoryScope } from '../types.js';
import { detectProject } from '../runner/project.js';
import { parseFlags } from './_utils.js';
import type { PhConfig } from '../config/index.js';
import { MemoryService } from '../memory/service.js';
import { decodePromptMetadata } from '../interaction/detail.js';
import { patchPromptMetadata } from '../interaction/lifecycle.js';

const SCOPES: MemoryScope[] = ['project', 'work', 'personal'];
const KINDS: MemoryKind[] = ['decision', 'insight', 'preference', 'fact'];

export const MEMORY_USAGE = `Usage:
  ph memory add "<content>" [--kind decision|insight|preference|fact] [--scope project|work|personal]
                            [--project <name>] [--prompts 12,15] [--sensitive]
  ph memory list [--project <name>] [--scope <scope>] [--all] [--limit n]
  ph memory search "<query>" [--project <name>] [--scope <scope>] [--include-personal] [--include-sensitive] [--limit n]
  ph memory show <id>
  ph memory forget <id>
  ph memory restore <id>
  ph memory retry <interaction-id>
  ph memory undo <interaction-id>

Memories use local SQLite unless a shared memory hub is configured. Project
scope is the default inside a detected project. Personal and sensitive memories
are excluded from ordinary context and MCP retrieval.
`;

export function parsePromptIds(raw: unknown): number[] {
  if (raw === undefined || raw === true) return [];
  const ids = String(raw).split(',').map(value => value.trim().replace(/^#/, '')).filter(Boolean).map(Number);
  if (ids.some(id => !Number.isInteger(id) || id < 1)) throw new Error('--prompts expects comma-separated prompt IDs, e.g. 12,15');
  return ids;
}

export function formatMemory(memory: MemoryEntry): string {
  const sources = memory.prompt_ids.length ? memory.prompt_ids.map(id => `#${id}`).join(', ') : 'none';
  const where = memory.project ? `${memory.scope}:${memory.project}` : memory.scope;
  const status = memory.status === 'forgotten' ? ' [forgotten]' : '';
  return `#${memory.id} [${memory.kind} · ${where}]${status} ${memory.updated_at.slice(0, 10)}  sources: ${sources}\n  ${memory.content.replace(/\n/g, '\n  ')}`;
}

function parseScope(raw: unknown): MemoryScope | undefined {
  if (raw === undefined) return undefined;
  if (!SCOPES.includes(raw as MemoryScope)) throw new Error(`--scope must be one of: ${SCOPES.join(', ')}`);
  return raw as MemoryScope;
}

function parseLimit(raw: unknown, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error('--limit must be an integer between 1 and 100');
  return value;
}

function parseId(raw: string | undefined): number {
  const id = Number(String(raw ?? '').replace(/^#/, ''));
  if (!Number.isInteger(id) || id < 1) throw new Error('A numeric memory ID is required.');
  return id;
}

export async function cmdMemory(db: PhDB, args: string[], cwd = process.cwd(), cfg?: PhConfig): Promise<void> {
  const [sub, ...rest] = args;
  const { flags, positional } = parseFlags(rest);
  const detectedProject = detectProject(cwd).projectName || undefined;
  const memoryService = new MemoryService(db, cfg ?? {});
  memoryService.assertConfigured(sub ?? '');

  switch (sub) {
    case 'add':
    case 'save': {
      const content = positional.join(' ').trim();
      if (!content) throw new Error('Memory content is required.\n' + MEMORY_USAGE);
      const kind = (flags.kind as MemoryKind | undefined) ?? 'decision';
      if (!KINDS.includes(kind)) throw new Error(`--kind must be one of: ${KINDS.join(', ')}`);
      const explicitProject = typeof flags.project === 'string' ? flags.project : undefined;
      const scope = parseScope(flags.scope) ?? (explicitProject || detectedProject ? 'project' : 'work');
      const project = scope === 'project' ? (explicitProject ?? detectedProject) : explicitProject;
      if (scope === 'project' && !project) throw new Error('No project detected. Use --project <name> or --scope work.');
      const saved = await memoryService.save({
        content, kind, scope, project, prompt_ids: parsePromptIds(flags.prompts),
        sensitivity: flags.sensitive ? 'sensitive' : 'normal', source: 'manual',
      });
      if (saved.source === 'hub') {
        process.stdout.write(`Saved shared memory ${saved.id}.\n`);
        return;
      }
      const memory = saved.memory;
      process.stdout.write(`Saved memory #${memory.id}.\n${formatMemory(memory)}\n`);
      return;
    }
    case 'list':
    case 'search': {
      const query = sub === 'search' ? positional.join(' ').trim() : undefined;
      if (sub === 'search' && !query) throw new Error('A search query is required.\n' + MEMORY_USAGE);
      const scope = parseScope(flags.scope);
      const explicitProject = typeof flags.project === 'string' ? flags.project : undefined;
      const project = flags.all || scope === 'work' || scope === 'personal'
        ? explicitProject
        : (explicitProject ?? (sub === 'list' ? detectedProject : undefined));
      const result = await memoryService.search({
        query, project, scope, includeSensitive: Boolean(flags['include-sensitive']),
        includePersonal: Boolean(flags['include-personal']) || scope === 'personal', limit: parseLimit(flags.limit, 20),
      });
      if (result.source === 'hub') {
        if (!result.shared.length) { process.stdout.write(query ? `No memories match "${query}".\n` : 'No memories saved yet.\n'); return; }
        process.stdout.write(result.shared.map(memory => {
          const id = String(memory.id ?? 'unknown');
          const where = `${String(memory.scope ?? 'work')}${memory.project ? `:${String(memory.project)}` : ''}`;
          const source = memory.source_ref ? ` · source: ${String(memory.source_ref)}` : '';
          const sensitivity = memory.sensitivity === 'sensitive' ? ' · sensitive' : '';
          return `#${id} [${String(memory.kind ?? 'fact')} · ${where}${sensitivity}]${source}\n  ${String(memory.content ?? '')}`;
        }).join('\n\n') + '\n');
        return;
      }
      const memories = result.local;
      if (memories.length === 0) {
        process.stdout.write(query ? `No memories match "${query}".\n` : 'No memories saved yet. Use `ph memory add "<decision>"`.\n');
        return;
      }
      process.stdout.write(memories.map(formatMemory).join('\n\n') + '\n');
      return;
    }
    case 'show': {
      const result = await memoryService.get(String(positional[0] ?? ''));
      if (!result.memory) throw new Error('Memory not found.');
      if (result.source === 'hub') {
        process.stdout.write(`${JSON.stringify(result.memory, null, 2)}\n`);
        return;
      }
      process.stdout.write(formatMemory(result.memory) + '\n');
      return;
    }
    case 'forget': {
      const id = String(positional[0] ?? '');
      const result = await memoryService.forget(id);
      if (!result.changed) {
        if (result.source === 'local') {
          const numeric = Number(id.replace(/^#/, ''));
          throw new Error(db.getMemoryById(numeric) ? `Memory #${numeric} is already forgotten.` : 'Memory not found.');
        }
        throw new Error('Memory not found.');
      }
      if (result.source === 'hub') {
        process.stdout.write(`Forgot shared memory ${id}. Restore it with: ph memory restore ${id}\n`);
        return;
      }
      process.stdout.write(`Forgot memory #${id.replace(/^#/, '')}. Restore it with: ph memory restore ${id}\n`);
      return;
    }
    case 'restore': {
      const id = String(positional[0] ?? '');
      const result = await memoryService.restore(id);
      process.stdout.write(`Restored ${result.source === 'hub' ? 'shared memory' : 'memory'} ${id}.\n`);
      return;
    }
    case 'undo': {
      const id = parseId(positional[0]);
      const entry = db.getById(id);
      if (!entry) throw new Error(`Interaction #${id} was not found.`);
      const memoryIds = decodePromptMetadata(entry.metadata).automatic_memory_ids ?? [];
      if (!memoryIds.length || !cfg) { process.stdout.write(`No automatically saved memories for interaction #${id}.\n`); return; }
      let forgotten = 0;
      for (const memoryId of memoryIds) if ((await memoryService.forget(memoryId)).changed) forgotten++;
      patchPromptMetadata(db, id, { automatic_memory_status: 'undone' });
      process.stdout.write(`Undid ${forgotten} automatic memory item(s) from interaction #${id}.\n`);
      return;
    }
    case 'retry': {
      const id = parseId(positional[0]);
      const { cmdBackgroundMemory } = await import('./background-memory.js');
      await cmdBackgroundMemory(db.dbPath, [String(id)]);
      const entry = db.getById(id);
      if (!entry) throw new Error(`Interaction #${id} was not found.`);
      process.stdout.write(`Automatic memory for interaction #${id}: ${decodePromptMetadata(entry.metadata).automatic_memory_status ?? 'not scheduled'}\n`);
      return;
    }
    default:
      process.stdout.write(MEMORY_USAGE);
  }
}
