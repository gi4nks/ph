import http from 'http';
import { URL } from 'url';
import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { MAX_REQUEST_BODY_BYTES } from '../sync/protocol.js';
import { json, readBody } from './http-utils.js';
import { authorizeHistoryRequest, handleHistoryRoute } from './routes/history.js';
import { authorizeMemoryRequest, handleSharedMemoryRoute, matchesMemoryRoute } from './routes/shared-memory.js';

/** HTTP adapter: bound and parse requests, select a capability, and encode its result. */
export function createRequestHandler(db: PhDB, cfg: PhConfig) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, { status: 'ok' });
      return;
    }

    const memoryRoute = matchesMemoryRoute(url.pathname);
    const authorized = url.pathname === '/health' || (memoryRoute ? authorizeMemoryRequest(req, cfg) : authorizeHistoryRequest(req, cfg));
    if (!authorized) {
      json(res, 401, { error: 'unauthorized' });
      return;
    }
    try {
      const body = await readBody(req, MAX_REQUEST_BODY_BYTES);
      const handled = memoryRoute
        ? await handleSharedMemoryRoute(req, res, body, db)
        : await handleHistoryRoute(req, res, body, db, cfg);
      if (!handled) json(res, 404, { error: `Not found: ${req.method || 'GET'} ${url.pathname}` });
    } catch (err) {
      if ((err as Error).name === 'RequestBodyTooLargeError') json(res, 413, { error: 'request body too large' });
      else if (err instanceof SyntaxError) json(res, 400, { error: 'invalid JSON request body' });
      else json(res, 500, { error: 'internal server error' });
    }
  };
}
