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
    db.insert({ timestamp: '2026-10-09T10:00:00.000Z', tool: 'claude', prompt: 'Explain SQLite WAL checkpoint behavior', response: 'A checkpoint copies frames back to the database.', args: '', workdir: '/project', hostname: 'test', exit_code: 0, metadata: JSON.stringify({ project: 'ph', role: 'explain', summary: 'SQLite WAL checkpoint behavior' }) });
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

  it('advertises tools and returns matching history through tools/call', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map(tool => tool.name)).toContain('search_prompts');
    const result = await client.callTool({ name: 'search_prompts', arguments: { query: 'SQLite', project: 'ph' } });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain('checkpoint');
  });

  it('shares contextual retrieval and preserves validated prompt provenance on decisions', async () => {
    const context = await client.callTool({ name: 'check_project_knowledge', arguments: { project: 'ph', task: 'WAL checkpoint behavior' } });
    expect(JSON.stringify(context.content)).toContain('#1');
    const saved = await client.callTool({ name: 'save_decision', arguments: {
      project: 'ph', summary: 'SQLite checkpoints copy WAL frames', promptIds: [1],
    } });
    expect(saved.isError).not.toBe(true);
    expect(db.searchMemories('ph')[0].prompt_ids).toEqual([1]);
  });

  it('rejects decision source IDs from another project before writing', async () => {
    db.insert({ timestamp: '2026-10-09T10:00:00.000Z', tool: 'claude', prompt: 'Other project prompt', response: '', args: '', workdir: '/other', hostname: 'test', exit_code: 0, metadata: JSON.stringify({ project: 'lens' }) });
    const result = await client.callTool({ name: 'save_decision', arguments: { project: 'ph', summary: 'bad source', promptIds: [2] } });
    expect(result.isError).toBe(true);
    expect(db.searchMemories('ph')).toHaveLength(0);
  });

  it('provides coding agents with scoped shared-memory search and safe saves', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      requests.push({ url, body });
      if (url.endsWith('/api/memories/search')) {
        return new Response(JSON.stringify({ memories: [
          { id: 'safe-id', content: 'A work decision', scope: 'work', kind: 'decision', sensitivity: 'normal', source: 'mcp-coding-agent', source_ref: 'prompt:1' },
          { id: 'private-id', content: 'Sensitive fact', scope: 'personal', kind: 'fact', sensitivity: 'sensitive', source: 'manual' },
        ] }), { status: 200 });
      }
      return new Response(JSON.stringify({ memory: { id: 'saved-id' } }), { status: 201 });
    }));

    const hubServer = createMCPServer(db, { memoryHubUrl: 'https://memory.example', memoryHubApiKey: 'client-key' });
    const hubClient = new Client({ name: 'ph-hub-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([hubClient.connect(clientTransport), hubServer.connect(serverTransport)]);
    try {
      const tools = await hubClient.listTools();
      expect(tools.tools.map(tool => tool.name)).toContain('save_shared_memory');
      const found = await hubClient.callTool({ name: 'search_shared_memory', arguments: { query: 'work decision', scope: 'work' } });
      expect(JSON.stringify(found.content)).toContain('A work decision');
      expect(JSON.stringify(found.content)).not.toContain('Sensitive fact');
      expect(requests[0].body).toMatchObject({ scope: 'work', include_sensitive: false });

      const saved = await hubClient.callTool({ name: 'save_shared_memory', arguments: {
        content: 'Keep migration reviews source-backed', scope: 'project', kind: 'preference', source_ref: 'prompt:1',
      } });
      expect(saved.isError).not.toBe(true);
      expect(requests[1].body).toMatchObject({
        content: 'Keep migration reviews source-backed', scope: 'project', sensitivity: 'normal', source: 'mcp-coding-agent', source_ref: 'prompt:1',
      });
      expect(requests[1].body['explicit_sensitive']).toBeUndefined();

      const sensitive = await hubClient.callTool({ name: 'save_shared_memory', arguments: {
        content: 'Sensitive fact', scope: 'personal', kind: 'fact', source_ref: 'prompt:1',
      } });
      expect(sensitive.isError).toBe(true);
      expect(requests).toHaveLength(2);
    } finally {
      await hubClient.close();
      await hubServer.close();
    }
  });
});
