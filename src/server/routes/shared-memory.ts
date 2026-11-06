import { timingSafeEqual } from 'crypto';
import type http from 'http';
import type { PhConfig } from '../../config/index.js';
import { resolveServerAuthConfig } from '../../config/runtime.js';
import type { MemoryKind } from '../../types.js';
import type { PhDB } from '../../db/index.js';
import { json } from '../http-utils.js';

export function matchesMemoryRoute(path: string): boolean {
  return path === '/api/memories' || path.startsWith('/api/memories/');
}

export function authorizeMemoryRequest(req: http.IncomingMessage, cfg: PhConfig): boolean {
  const key = resolveServerAuthConfig(cfg).memoryHubApiKey;
  return authorizedWithKey(req, key);
}

export async function handleSharedMemoryRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
  db: PhDB,
): Promise<boolean> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  if (method === 'POST' && path === '/api/memories') {
    const input = JSON.parse(body) as Record<string, unknown>;
    const content = typeof input.content === 'string' ? input.content.trim() : '';
    const scope = input.scope ?? 'work';
    const sensitivity = input.sensitivity ?? 'normal';
    const kind = input.kind ?? 'fact';
    const source = input.source ?? 'manual';
    const project = typeof input.project === 'string' ? input.project.trim() : '';
    const sourceRef = input.source_ref;
    const id = typeof input.id === 'string' ? input.id : '';
    if (!content || content.length > 8000) { json(res, 400, { error: 'content must contain 1 to 8000 characters' }); return true; }
    if (!['work', 'personal', 'project'].includes(String(scope))) { json(res, 400, { error: 'scope must be work, personal, or project' }); return true; }
    if (scope === 'project' && !project) { json(res, 400, { error: 'project is required for project scope' }); return true; }
    if (!['normal', 'sensitive'].includes(String(sensitivity))) { json(res, 400, { error: 'sensitivity must be normal or sensitive' }); return true; }
    if (sensitivity === 'sensitive' && input.explicit_sensitive !== true) { json(res, 403, { error: 'sensitive memories require explicit_sensitive: true' }); return true; }
    if (typeof kind !== 'string' || !['decision', 'insight', 'preference', 'fact'].includes(kind)) { json(res, 400, { error: 'kind must be decision, insight, preference, or fact' }); return true; }
    if (typeof source !== 'string' || !source.trim() || source.length > 120) { json(res, 400, { error: 'source must contain 1 to 120 characters' }); return true; }
    if (!/^[0-9a-f-]{36}$/i.test(id)) { json(res, 400, { error: 'id must be a UUID' }); return true; }
    if (sourceRef !== undefined && (typeof sourceRef !== 'string' || sourceRef.length > 500)) { json(res, 400, { error: 'source_ref must be a string up to 500 characters' }); return true; }
    try {
      const saved = db.addMemory({
        content, scope: scope as 'work' | 'personal' | 'project', project, kind: kind as MemoryKind,
        sensitivity: sensitivity as 'normal' | 'sensitive', source: source.trim(), external_id: id,
        ...(typeof sourceRef === 'string' ? { source_ref: sourceRef } : {}),
      });
      json(res, 201, { memory: { ...saved, id } });
    } catch (error) {
      const message = (error as Error).message;
      json(res, message.includes('memory id already exists') ? 409 : 400, { error: message });
    }
    return true;
  }

  if (method === 'POST' && path === '/api/memories/search') {
    const input = JSON.parse(body) as Record<string, unknown>;
    const query = typeof input.query === 'string' ? input.query.trim() : undefined;
    const scope = ['work', 'personal', 'project'].includes(String(input.scope)) ? input.scope as 'work' | 'personal' | 'project' : undefined;
    const project = typeof input.project === 'string' ? input.project.trim() : undefined;
    const limit = Math.max(1, Math.min(Number(input.limit) || 10, 100));
    const memories = db.searchMemories({ query, scope, project, includePersonal: input.include_personal === true || input.include_sensitive === true, includeSensitive: input.include_sensitive === true, limit })
      .filter(memory => input.include_sensitive === true || memory.sensitivity !== 'sensitive')
      .map(memory => ({ ...memory, id: memory.external_id ?? String(memory.id) }));
    json(res, 200, { memories });
    return true;
  }

  const memoryPath = /^\/api\/memories\/([0-9a-f-]{36})(?:\/(restore))?$/i.exec(path);
  if (memoryPath) {
    const memory = db.getMemoryByExternalId(memoryPath[1]!);
    if (!memory) { json(res, 404, { error: 'memory not found' }); return true; }
    if (method === 'GET' && !memoryPath[2]) { json(res, 200, { memory: { ...memory, id: memory.external_id } }); return true; }
    if (method === 'DELETE' && !memoryPath[2]) { db.forgetMemory(memory.id); json(res, 200, { forgotten: true }); return true; }
    if (method === 'POST' && memoryPath[2]) { db.restoreMemory(memory.id); json(res, 200, { restored: true }); return true; }
  }
  return false;
}

function authorizedWithKey(req: http.IncomingMessage, key?: string): boolean {
  if (!key?.trim()) return false;
  const expected = Buffer.from(`Bearer ${key}`);
  const actual = Buffer.from(req.headers.authorization ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
