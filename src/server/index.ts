import http from 'http';
import { PhDB, defaultPath } from '../db/index.js';
import { load as loadConfig } from '../config/index.js';
import { getEmbeddings } from '../embedding/index.js';
import type { PromptMetadata } from '../types.js';
import { createHash } from 'crypto';

export async function runServer(port: number = 3001, host: string = '0.0.0.0'): Promise<void> {
  const cfg = loadConfig();
  const dbPath = process.env.PH_DB ?? cfg.dbPath ?? defaultPath();
  const db = new PhDB(dbPath);

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const body = await readBody(req);
      await route(req, res, body, db, cfg);
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      console.error(`ph server listening on http://${host}:${port}`);
      resolve();
    });
  });
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, body: string, db: PhDB, cfg: Record<string, any>): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  if (method === 'GET' && path === '/health') {
    return json(res, 200, { status: 'ok', dbPath: (db as any).db?.name || 'unknown' });
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

    const results = db.searchSemantic(queryVec, limit * 2);
    const filtered = project
      ? results.filter(e => {
          try {
            const meta = JSON.parse(e.metadata) as PromptMetadata;
            return meta.project === project;
          } catch { return false; }
        }).slice(0, limit)
      : results.slice(0, limit);

    return json(res, 200, { prompts: filtered });
  }

  if (method === 'POST' && path === '/api/sync/push') {
    const { prompts } = JSON.parse(body);
    if (!Array.isArray(prompts)) return json(res, 400, { error: 'prompts must be an array' });

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const p of prompts) {
      try {
        const hash = sha256(`${p.tool}|${p.prompt}|${p.response}`);
        const existing = db.db.prepare("SELECT id FROM prompts WHERE json_extract(metadata, '$.sync_hash') = ?").get(hash) as { id: number } | undefined;
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
      } catch (e) {
        errors.push((e as Error).message);
      }
    }

    return json(res, 200, { imported, skipped, errors });
  }

  if (method === 'POST' && path === '/api/sync/pull') {
    const { since } = JSON.parse(body);
    const limit = 10000;
    let results;
    if (since) {
      results = db.db.prepare('SELECT * FROM prompts WHERE timestamp > ? ORDER BY timestamp ASC LIMIT ?').all(since, limit) as any[];
    } else {
      results = db.db.prepare('SELECT * FROM prompts ORDER BY timestamp ASC LIMIT ?').all(limit) as any[];
    }
    return json(res, 200, { prompts: results, hasMore: results.length >= limit });
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
    const total = (db.db.prepare('SELECT count(*) as c FROM prompts').get() as any).c;
    const totalMemories = (db.db.prepare('SELECT count(*) as c FROM memories').get() as any).c;
    const byTool = db.db.prepare('SELECT tool, count(*) as count FROM prompts GROUP BY tool ORDER BY count DESC').all();
    return json(res, 200, { total, totalMemories, byTool });
  }

  json(res, 404, { error: `Not found: ${method} ${path}` });
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET') return resolve('');
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
