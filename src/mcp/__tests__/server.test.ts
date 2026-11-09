import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    db.insert({
      timestamp: '2026-10-09T10:00:00.000Z', tool: 'claude',
      prompt: 'Explain SQLite WAL checkpoint behavior',
      response: 'A checkpoint copies frames back to the database.',
      args: '', workdir: '/project', hostname: 'test', exit_code: 0,
      metadata: JSON.stringify({ project: 'ph', role: 'explain', summary: 'SQLite WAL checkpoint behavior' }),
    });
    server = createMCPServer(db, {});
    client = new Client({ name: 'ph-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await client.close();
    await server.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('advertises the five orthogonal MCP tools', async () => {
    const tools = await client.listTools();
    const names = tools.tools.map(tool => tool.name).sort();
    expect(names).toEqual([
      'get_interaction',
      'get_project_context',
      'save_memory',
      'search_history',
      'search_memories',
    ]);
  });

  it('search_history finds interactions by text query', async () => {
    const result = await client.callTool({ name: 'search_history', arguments: { query: 'checkpoint', project: 'ph' } });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain('checkpoint');
  });

  it('get_interaction retrieves one full interaction by id', async () => {
    const result = await client.callTool({ name: 'get_interaction', arguments: { id: 1 } });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain('Explain SQLite WAL');
    expect(JSON.stringify(result.content)).toContain('copies frames back');
  });

  it('get_project_context retrieves unified project context', async () => {
    const result = await client.callTool({ name: 'get_project_context', arguments: { project: 'ph' } });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain('Interaction #1');
  });

  it('save_memory persists a new memory and search_memories finds it', async () => {
    const saveRes = await client.callTool({
      name: 'save_memory',
      arguments: {
        content: 'WAL checkpoints require active write lock',
        scope: 'project',
        project: 'ph',
        kind: 'fact',
        tags: ['wal', 'sqlite'],
      },
    });
    expect(saveRes.isError).not.toBe(true);
    expect(JSON.stringify(saveRes.content)).toContain('Saved memory');

    const searchRes = await client.callTool({
      name: 'search_memories',
      arguments: { query: 'checkpoints', project: 'ph' },
    });
    expect(searchRes.isError).not.toBe(true);
    expect(JSON.stringify(searchRes.content)).toContain('WAL checkpoints require active write lock');
  });
});
