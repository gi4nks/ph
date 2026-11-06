import type http from 'http';
import { timingSafeEqual } from 'crypto';
import type { PhConfig } from '../../config/index.js';
import { resolveServerAuthConfig } from '../../config/runtime.js';
import { getEmbeddings } from '../../embedding/index.js';
import type { PhDB } from '../../db/index.js';
import { SYNC_PAGE_SIZE } from '../../sync/protocol.js';
import { syncHash } from '../../utils/syncHash.js';
import { json } from '../http-utils.js';

export function authorizeHistoryRequest(req: http.IncomingMessage, cfg: PhConfig): boolean {
  const key = resolveServerAuthConfig(cfg).historyApiKey;
  if (!key?.trim()) return false;
  const expected = Buffer.from(`Bearer ${key}`);
  const actual = Buffer.from(req.headers.authorization ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function handleHistoryRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
  db: PhDB,
  cfg: PhConfig,
): Promise<boolean> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  if (method === 'POST' && path === '/api/prompts/search') {
    const { query, tool, project, role, tag, since, until, limit = 10 } = JSON.parse(body);
    const results = db.search({ query, tool, project, role, tag, ...(since ? { since: new Date(since) } : {}), ...(until ? { until: new Date(until) } : {}), limit });
    json(res, 200, { prompts: results });
    return true;
  }
  if (method === 'POST' && path === '/api/prompts/by-id') {
    const { id } = JSON.parse(body);
    const entry = db.getById(id);
    if (!entry) json(res, 404, { error: `Prompt #${id} not found` });
    else json(res, 200, { prompt: entry });
    return true;
  }
  if (method === 'POST' && path === '/api/prompts/semantic') {
    const { query, project, limit = 5 } = JSON.parse(body);
    if (!query) { json(res, 400, { error: 'query is required' }); return true; }
    const ollamaUrl = cfg.ollamaUrl ?? 'http://localhost:11434';
    const model = cfg.ollamaEmbedModel ?? 'nomic-embed-text-v2-moe';
    const [queryVec] = await getEmbeddings([query], ollamaUrl, model, 1);
    if (!queryVec) json(res, 500, { error: 'Failed to generate embedding' });
    else json(res, 200, { prompts: db.searchSemantic(queryVec, limit, project) });
    return true;
  }
  if (method === 'POST' && path === '/api/sync/push') {
    const { prompts } = JSON.parse(body);
    if (!Array.isArray(prompts)) { json(res, 400, { error: 'prompts must be an array' }); return true; }
    if (prompts.length > SYNC_PAGE_SIZE) { json(res, 400, { error: `prompts must contain at most ${SYNC_PAGE_SIZE} records` }); return true; }
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const prompt of prompts) {
      try {
        const hash = syncHash(prompt);
        if (db.getPromptBySyncHash(hash)) { skipped++; continue; }
        const metaObj = { ...JSON.parse(prompt.metadata || '{}'), sync_hash: hash };
        db.insert({
          timestamp: prompt.timestamp || new Date().toISOString(), tool: prompt.tool || 'unknown', prompt: prompt.prompt || '',
          response: prompt.response || '', args: prompt.args || '', workdir: prompt.workdir || '', hostname: prompt.hostname || '',
          exit_code: prompt.exit_code ?? 0, metadata: JSON.stringify(metaObj),
        });
        imported++;
      } catch { errors.push('record rejected'); }
    }
    json(res, 200, { imported, skipped, errors, databaseId: db.databaseId });
    return true;
  }
  if (method === 'POST' && path === '/api/sync/pull') {
    const { afterId = 0, limit = SYNC_PAGE_SIZE } = JSON.parse(body);
    if (!Number.isInteger(afterId) || afterId < 0 || !Number.isInteger(limit) || limit < 1 || limit > SYNC_PAGE_SIZE) {
      json(res, 400, { error: 'afterId and limit are outside the supported range' });
      return true;
    }
    const page = db.getPromptsAfterId(afterId, limit + 1);
    const hasMore = page.length > limit;
    const prompts = hasMore ? page.slice(0, limit) : page;
    json(res, 200, { prompts, hasMore, nextCursor: prompts.at(-1)?.id ?? afterId, databaseId: db.databaseId });
    return true;
  }
  if (method === 'GET' && path === '/api/stats') {
    const { total, totalMemories, byTool } = db.getStats();
    json(res, 200, { total, totalMemories, byTool });
    return true;
  }
  return false;
}
