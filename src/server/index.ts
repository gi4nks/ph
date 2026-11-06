import http from 'http';
import { PhDB, defaultPath } from '../db/index.js';
import { load as loadConfig } from '../config/index.js';
import type { PhConfig } from '../config/index.js';
import { resolveServerAuthConfig } from '../config/runtime.js';
import { createRequestHandler } from './request-handler.js';

export { createRequestHandler } from './request-handler.js';

export async function runServer(port: number = 3001, host: string = '127.0.0.1'): Promise<void> {
  const cfg = { ...loadConfig(), ...(process.env.PH_SERVER_API_KEY ? { remoteApiKey: process.env.PH_SERVER_API_KEY } : {}) };
  assertServerConfig(cfg);
  const dbPath = process.env.PH_DB ?? cfg.dbPath ?? defaultPath();
  const db = new PhDB(dbPath);
  const server = http.createServer(createRequestHandler(db, cfg));
  const configuredHost = process.env.PH_SERVER_HOST || host;
  const configuredPort = Number(process.env.PH_SERVER_PORT) || port;
  return new Promise((resolve) => {
    server.listen(configuredPort, configuredHost, () => {
      console.error(`ph server listening on http://${configuredHost}:${configuredPort}`);
      resolve();
    });
  });
}

export function assertServerConfig(cfg: PhConfig): void {
  const { historyApiKey: serverKey, memoryHubApiKey: memoryKey } = resolveServerAuthConfig(cfg);
  if (!serverKey?.trim() && !memoryKey?.trim()) {
    throw new Error('Set PH_SERVER_API_KEY or configure remote-api-key before starting the PH HTTP server; memory hub routes can use PH_MEMORY_HUB_API_KEY.');
  }
  if (serverKey && memoryKey && serverKey === memoryKey) throw new Error('Use different values for PH_SERVER_API_KEY and PH_MEMORY_HUB_API_KEY.');
}
