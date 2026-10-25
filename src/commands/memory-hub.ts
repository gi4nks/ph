import { randomUUID } from 'node:crypto';
import type { PhConfig } from '../config/index.js';
import type { PersonalMemoryScope } from '../types.js';
import { parseFlags } from './_utils.js';
import { PhDB } from '../db/index.js';
import { decodePromptMetadata } from '../interaction/detail.js';

const scopes = new Set<PersonalMemoryScope>(['work', 'personal', 'project']);

export async function cmdMemoryHub(cfg: PhConfig, args: string[], dbPath?: string): Promise<void> {
  const base = process.env['PH_MEMORY_HUB_URL'] || cfg.memoryHubUrl;
  if (!base) throw new Error('Memory hub is not configured. Set PH_MEMORY_HUB_URL or run ph config set memory-hub-url <url>.');
  const apiKey = process.env['PH_MEMORY_HUB_API_KEY'] || cfg.memoryHubApiKey;
  if (!apiKey) throw new Error('Memory hub key is not configured. Run ph config set memory-hub-api-key.');
  const { flags, positional } = parseFlags(args);
  const [action, ...rest] = positional;
  const root = base.replace(/\/+$/, '');

  if (action === 'save') {
    const content = rest.join(' ').trim() || (process.stdin.isTTY ? '' : (await readStdin()).trim());
    if (!content) throw new Error('Usage: ph memory save <text> [--scope work|personal|project] [--kind fact] [--sensitive] [--source <label>] [--source-ref <id>]');
    const scope = String(flags['scope'] ?? 'work') as PersonalMemoryScope;
    if (!scopes.has(scope)) throw new Error('--scope must be work, personal, or project');
    const result = await request(root, apiKey, '/api/memories', {
      method: 'POST', body: {
        id: randomUUID(), content, scope,
        kind: String(flags['kind'] ?? 'fact'),
        sensitivity: flags['sensitive'] ? 'sensitive' : 'normal',
        ...(flags['sensitive'] ? { explicit_sensitive: true } : {}),
        source: String(flags['source'] ?? 'manual'),
        ...(flags['source-ref'] ? { source_ref: String(flags['source-ref']) } : {}),
      },
    });
    const memory = result['memory'] as { id: string };
    process.stdout.write(`Saved memory ${memory.id} to the PH hub.\n`);
    return;
  }

  if (action === 'search') {
    const scope = flags['scope'] as PersonalMemoryScope | undefined;
    if (scope && !scopes.has(scope)) throw new Error('--scope must be work, personal, or project');
    const result = await request(root, apiKey, '/api/memories/search', {
      method: 'POST', body: {
        query: rest.join(' ') || undefined, scope, limit: Number(flags['limit'] ?? 20),
        include_sensitive: flags['include-sensitive'] === true,
      },
    });
    const memories = result['memories'] as Array<{ id: string; content: string; scope: string; kind: string; sensitivity: string; source: string; source_ref?: string }>;
    if (!memories.length) { process.stdout.write('No matching memories.\n'); return; }
    for (const memory of memories) {
      process.stdout.write(`${memory.id}  [${memory.scope}/${memory.kind}${memory.sensitivity === 'sensitive' ? ', sensitive' : ''}] ${memory.content}\n`);
      process.stdout.write(`  Source: ${memory.source}${memory.source_ref ? ` (${memory.source_ref})` : ''}\n`);
    }
    return;
  }

  if (action === 'show' && rest[0]) {
    const result = await request(root, apiKey, `/api/memories/${encodeURIComponent(rest[0])}`);
    process.stdout.write(`${JSON.stringify(result['memory'], null, 2)}\n`);
    return;
  }

  if (action === 'forget' && rest[0]) {
    await request(root, apiKey, `/api/memories/${encodeURIComponent(rest[0])}`, { method: 'DELETE' });
    process.stdout.write(`Forgot memory ${rest[0]}. Restore it with: ph memory restore ${rest[0]}\n`);
    return;
  }

  if (action === 'restore' && rest[0]) {
    await request(root, apiKey, `/api/memories/${encodeURIComponent(rest[0])}/restore`, { method: 'POST', body: {} });
    process.stdout.write(`Restored memory ${rest[0]}.\n`);
    return;
  }

  if (action === 'undo' && rest[0]) {
    const id = Number.parseInt(rest[0], 10);
    if (!Number.isInteger(id) || id < 1 || !dbPath) throw new Error('Usage: ph memory undo <interaction-id>');
    const db = new PhDB(dbPath);
    try {
      const entry = db.getById(id);
      if (!entry) throw new Error(`Interaction #${id} was not found.`);
      const memories = decodePromptMetadata(entry.metadata).automatic_memory_ids ?? [];
      if (!memories.length) { process.stdout.write(`No automatically saved memories for interaction #${id}.\n`); return; }
      let forgotten = 0;
      const forgottenIds: string[] = [];
      for (const memoryId of memories) if (await forgetHubMemory(cfg, memoryId)) { forgotten++; forgottenIds.push(memoryId); }
      process.stdout.write(`Undid ${forgotten} automatic memory item(s) from interaction #${id}.\n`);
      for (const memoryId of forgottenIds) process.stdout.write(`  ${memoryId} (restore: ph memory restore ${memoryId})\n`);
    } finally { db.close(); }
    return;
  }

  if (action === 'retry' && rest[0]) {
    const id = Number.parseInt(rest[0], 10);
    if (!Number.isInteger(id) || id < 1 || !dbPath) throw new Error('Usage: ph memory retry <interaction-id>');
    const { cmdBackgroundMemory } = await import('./background-memory.js');
    await cmdBackgroundMemory(dbPath, [String(id)]);
    const db = new PhDB(dbPath);
    try {
      const entry = db.getById(id);
      if (!entry) throw new Error(`Interaction #${id} was not found.`);
      const metadata = decodePromptMetadata(entry.metadata);
      process.stdout.write(`Automatic memory for interaction #${id}: ${metadata.automatic_memory_status ?? 'not scheduled'}\n`);
      if (metadata.automatic_memory_ids?.length) process.stdout.write(`Saved memory IDs: ${metadata.automatic_memory_ids.join(', ')}\n`);
    } finally { db.close(); }
    return;
  }

  process.stdout.write(`PH memory hub commands:
  ph memory save <text> [--scope work|personal|project] [--sensitive]
  ph memory search [query] [--scope work|personal|project] [--include-sensitive]
  ph memory show <id>
  ph memory forget <id>
  ph memory restore <id>
  ph memory undo <interaction-id>
  ph memory retry <interaction-id>

Sensitive memories require the explicit --sensitive flag.\n`);
}

export async function searchHubMemories(cfg: PhConfig, query: string, scope: PersonalMemoryScope): Promise<Array<{ content: string; source: string; source_ref?: string }>> {
  if (!(process.env['PH_MEMORY_HUB_URL'] || cfg.memoryHubUrl)
    || !(process.env['PH_MEMORY_HUB_API_KEY'] || cfg.memoryHubApiKey)) return [];
  return (await searchHubMemoryRecords(cfg, query, scope, 5)).map(({ content, source, source_ref }) => ({ content, source, ...(source_ref ? { source_ref } : {}) }));
}

export async function searchHubMemoryRecords(cfg: PhConfig, query: string, scope: PersonalMemoryScope, limit = 5): Promise<Array<{
  id: string; content: string; scope: PersonalMemoryScope; kind: string; sensitivity: 'normal' | 'sensitive'; source: string; source_ref?: string;
}>> {
  const base = process.env['PH_MEMORY_HUB_URL'] || cfg.memoryHubUrl;
  const apiKey = process.env['PH_MEMORY_HUB_API_KEY'] || cfg.memoryHubApiKey;
  if (!base || !apiKey) throw new Error('Memory hub is not configured. Set memory-hub-url and memory-hub-api-key.');
  const result = await request(base.replace(/\/+$/, ''), apiKey, '/api/memories/search', {
    method: 'POST', body: { query, scope, limit, include_sensitive: false },
  });
  return result['memories'] as Array<{
    id: string; content: string; scope: PersonalMemoryScope; kind: string; sensitivity: 'normal' | 'sensitive'; source: string; source_ref?: string;
  }>;
}

export async function saveHubMemory(cfg: PhConfig, memory: {
  id?: string; content: string; scope: PersonalMemoryScope; kind: string; source: string; source_ref?: string;
}): Promise<string> {
  const base = process.env['PH_MEMORY_HUB_URL'] || cfg.memoryHubUrl;
  const apiKey = process.env['PH_MEMORY_HUB_API_KEY'] || cfg.memoryHubApiKey;
  if (!base || !apiKey) throw new Error('Memory hub is not configured.');
  const result = await request(base.replace(/\/+$/, ''), apiKey, '/api/memories', {
    method: 'POST', body: { ...memory, id: memory.id ?? randomUUID(), sensitivity: 'normal' },
  });
  return (result['memory'] as { id: string }).id;
}

async function forgetHubMemory(cfg: PhConfig, id: string): Promise<boolean> {
  const base = process.env['PH_MEMORY_HUB_URL'] || cfg.memoryHubUrl;
  const apiKey = process.env['PH_MEMORY_HUB_API_KEY'] || cfg.memoryHubApiKey;
  if (!base || !apiKey) throw new Error('Memory hub is not configured.');
  const response = await fetch(`${base.replace(/\/+$/, '')}/api/memories/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Memory hub forget failed (${response.status}).`);
  return true;
}

async function request(base: string, key: string, route: string, options: { method?: string; body?: unknown } = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}${route}`, {
    method: options.method ?? 'GET',
    headers: { Authorization: `Bearer ${key}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload['error'] === 'string' ? payload['error'] : `Memory hub request failed (${response.status}).`);
  return payload;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
