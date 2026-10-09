import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhDB } from '../../db/index.js';
import { createMCPServer } from '../server.js';

describe('ph MCP protocol', () => {
  let dir: string;
  let db: PhDB;
  let server: ReturnType<typeof createMCPServer>;
  let client: Client;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-mcp-'));
    db = new PhDB(path.join(dir, 'test.db'));
    db.insert({ timestamp: '2026-10-09T10:00:00.000Z', tool: 'claude', prompt: 'Explain SQLite WAL checkpoint behavior', response: 'A checkpoint copies frames back to the database.', args: '', workdir: '/project', hostname: 'test', exit_code: 0, metadata: JSON.stringify({ project: 'ph', role: 'explain' }) });
    server = createMCPServer(db, {});
    client = new Client({ name: 'ph-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('advertises tools and returns matching history through tools/call', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map(tool => tool.name)).toContain('search_prompts');
    const result = await client.callTool({ name: 'search_prompts', arguments: { query: 'SQLite', project: 'ph' } });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain('checkpoint');
  });
});
