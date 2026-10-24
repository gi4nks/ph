import http from 'http';
import { URL } from 'url';
import { PhDB, defaultPath } from '../db/index.js';
import { load as loadConfig } from '../config/index.js';
import type { PhConfig } from '../config/index.js';
import { getEmbeddings } from '../embedding/index.js';
import { syncHash } from '../utils/syncHash.js';
import { timingSafeEqual } from 'crypto';
import { MAX_REQUEST_BODY_BYTES, SYNC_PAGE_SIZE } from '../sync/protocol.js';

export async function runServer(port: number = 3001, host: string = '127.0.0.1'): Promise<void> {
  const cfg = loadConfig();
  assertServerConfig(cfg);
  const dbPath = process.env.PH_DB ?? cfg.dbPath ?? defaultPath();
  const db = new PhDB(dbPath);

  const server = http.createServer(createRequestHandler(db, cfg));

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      console.error(`ph server listening on http://${host}:${port}`);
      resolve();
    });
  });
}

export function assertServerConfig(cfg: PhConfig): void {
  if (!cfg.remoteApiKey?.trim()) {
    throw new Error('Configure remote-api-key before starting the PH HTTP server.');
  }
}

/**
 * Builds the request handler for a PhDB + config. Exported for testability
 * (SPEC-ISSUES-013: auth enforcement lives here).
 */
export function createRequestHandler(db: PhDB, cfg: PhConfig) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // Health is public; all other endpoints require a configured bearer key.
    if (url.pathname !== '/health' && !authorized(req, cfg)) {
      json(res, 401, { error: 'unauthorized' });
      return;
    }

    try {
      const body = await readBody(req, MAX_REQUEST_BODY_BYTES);
      await route(req, res, body, db, cfg);
    } catch (err) {
      if ((err as Error).name === 'RequestBodyTooLargeError') {
        json(res, 413, { error: 'request body too large' });
      } else if (err instanceof SyntaxError) {
        json(res, 400, { error: 'invalid JSON request body' });
      } else {
        json(res, 500, { error: 'internal server error' });
      }
    }
  };
}

function authorized(req: http.IncomingMessage, cfg: PhConfig): boolean {
  if (!cfg.remoteApiKey?.trim()) return false;
  const expected = `Bearer ${cfg.remoteApiKey}`;
  const a = Buffer.from(req.headers.authorization ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, body: string, db: PhDB, cfg: PhConfig): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  if (method === 'GET' && path === '/health') {
    return json(res, 200, { status: 'ok' });
  }

  if (method === 'POST' && path === '/api/prompts/search') {
    const { query, tool, project, role, tag, since, until, limit = 10 } = JSON.parse(body);
    const results = db.search({
      query,
      tool,
      project,
      role,
      tag,
      ...(since ? { since: new Date(since) } : {}),
      ...(until ? { until: new Date(until) } : {}),
      limit,
    });
    return json(res, 200, { prompts: results });
  }

  if (method === 'POST' && path === '/api/prompts/by-id') {
    const { id } = JSON.parse(body);
    const entry = db.getById(id);
    if (!entry) return json(res, 404, { error: `Prompt #${id} not found` });
    return json(res, 200, { prompt: entry });
  }

  if (method === 'POST' && path === '/api/prompts/semantic') {
    const { query, project, limit = 5 } = JSON.parse(body);
    if (!query) return json(res, 400, { error: 'query is required' });

    const ollamaUrl = cfg.ollamaUrl ?? 'http://localhost:11434';
    const model = cfg.ollamaEmbedModel ?? 'nomic-embed-text-v2-moe';
    const [queryVec] = await getEmbeddings([query], ollamaUrl, model, 1);
    if (!queryVec) return json(res, 500, { error: 'Failed to generate embedding' });

    const filtered = db.searchSemantic(queryVec, limit, project);

    return json(res, 200, { prompts: filtered });
  }

  if (method === 'POST' && path === '/api/sync/push') {
    const { prompts } = JSON.parse(body);
    if (!Array.isArray(prompts)) return json(res, 400, { error: 'prompts must be an array' });
    if (prompts.length > SYNC_PAGE_SIZE) return json(res, 400, { error: `prompts must contain at most ${SYNC_PAGE_SIZE} records` });

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const p of prompts) {
      try {
        const hash = syncHash(p);
        const existing = db.getPromptBySyncHash(hash);
        if (existing) { skipped++; continue; }

        const metaObj = { ...JSON.parse(p.metadata || '{}'), sync_hash: hash };
        db.insert({
          timestamp: p.timestamp || new Date().toISOString(),
          tool: p.tool || 'unknown',
          prompt: p.prompt || '',
          response: p.response || '',
          args: p.args || '',
          workdir: p.workdir || '',
          hostname: p.hostname || '',
          exit_code: p.exit_code ?? 0,
          metadata: JSON.stringify(metaObj),
        });
        imported++;
      } catch {
        errors.push('record rejected');
      }
    }

    return json(res, 200, { imported, skipped, errors });
  }

  if (method === 'POST' && path === '/api/sync/pull') {
    const { afterId = 0, limit = SYNC_PAGE_SIZE } = JSON.parse(body);
    if (!Number.isInteger(afterId) || afterId < 0 || !Number.isInteger(limit) || limit < 1 || limit > SYNC_PAGE_SIZE) {
      return json(res, 400, { error: 'afterId and limit are outside the supported range' });
    }
    const page = db.getPromptsAfterId(afterId, limit + 1);
    const hasMore = page.length > limit;
    const prompts = hasMore ? page.slice(0, limit) : page;
    const nextCursor = prompts.at(-1)?.id ?? afterId;
    return json(res, 200, { prompts, hasMore, nextCursor });
  }

  if (method === 'POST' && path === '/api/memories/search') {
    const { project, limit = 10 } = JSON.parse(body);
    const memories = project
      ? db.searchMemories(project, limit)
      : [];
    return json(res, 200, { memories });
  }

  if (method === 'POST' && path === '/api/memories/summary') {
    const { project } = JSON.parse(body);
    if (!project) return json(res, 400, { error: 'project is required' });
    const memories = db.searchMemories(project, 5);
    return json(res, 200, { memories });
  }

  if (method === 'GET' && path === '/api/stats') {
    const { total, totalMemories, byTool } = db.getStats();
    return json(res, 200, { total, totalMemories, byTool });
  }

  json(res, 404, { error: `Not found: ${method} ${path}` });
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET') return resolve('');
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      size += chunk.length;
      if (size > maxBytes) {
        rejected = true;
        const error = new Error('request body too large');
        error.name = 'RequestBodyTooLargeError';
        reject(error);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
