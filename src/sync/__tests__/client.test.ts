import { describe, expect, it, vi } from 'vitest';
import type { PromptEntry } from '../../types.js';
import { sendSyncPushPage, splitSyncPushPages } from '../client.js';

function prompt(id: number, response: string): PromptEntry {
  return {
    id, timestamp: '2026-10-24T10:00:00.000Z', tool: 'codex', prompt: `prompt-${id}`,
    response, args: '', workdir: '/project', hostname: 'host', exit_code: 0, metadata: '{}',
  };
}

describe('sync push body pagination', () => {
  it('splits pages by serialized byte size while preserving record order', () => {
    const prompts = [prompt(1, 'a'.repeat(180)), prompt(2, 'b'.repeat(180)), prompt(3, 'c'.repeat(180))];
    const pages = splitSyncPushPages(prompts, 400);

    expect(pages.map(page => page.map(item => item.id))).toEqual([[1], [2], [3]]);
    expect(pages.every(page => Buffer.byteLength(JSON.stringify({ prompts: page })) <= 400)).toBe(true);
  });

  it('reports an individual record larger than the configured request cap', () => {
    expect(() => splitSyncPushPages([prompt(9, 'x'.repeat(500))], 200)).toThrow(/interaction #9.*request body limit/i);
  });

  it('sends byte-bounded subpages and aggregates their acknowledgements', async () => {
    const prompts = [prompt(1, 'a'.repeat(180)), prompt(2, 'b'.repeat(180)), prompt(3, 'c'.repeat(180))];
    const sent: number[][] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: unknown }) => {
      const body = String(init?.body);
      expect(Buffer.byteLength(body)).toBeLessThanOrEqual(400);
      const page = JSON.parse(body).prompts as PromptEntry[];
      sent.push(page.map(item => item.id));
      return new Response(JSON.stringify({ imported: page.length, skipped: 0, errors: [] }), { status: 200 });
    }));

    await expect(sendSyncPushPage('https://remote.example', undefined, prompts, { maxBodyBytes: 400 }))
      .resolves.toEqual({ imported: 3, skipped: 0, errors: [] });
    expect(sent).toEqual([[1], [2], [3]]);
  });
});
