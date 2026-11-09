import { describe, expect, it, vi } from 'vitest';
import { formatProjectContext, getProjectContext, type ProjectContextStore } from '../index.js';
import type { MemoryEntry, PromptEntry } from '../../types.js';

const prompt = (id: number, project: string): PromptEntry => ({
  id, timestamp: '2026-10-01T12:00:00.000Z', tool: 'claude', prompt: `prompt ${id}`,
  response: '', args: '', workdir: `/work/${project}`, hostname: 'test', exit_code: 0,
  metadata: JSON.stringify({ project, summary: `summary ${id}` }),
});

const memory: MemoryEntry = {
  id: 12, scope: 'project', project: 'ph', kind: 'decision', content: 'Use local SQLite',
  prompt_ids: [], status: 'active', created_at: '2026-10-01T12:00:00.000Z',
  updated_at: '2026-10-01T12:00:00.000Z',
  sensitivity: 'normal', source: 'test',
};

function store(overrides: Partial<ProjectContextStore> = {}): ProjectContextStore {
  return {
    searchMemories: vi.fn(() => [memory]),
    search: vi.fn(() => [prompt(1, 'ph')]),
    getRecentProjectPrompts: vi.fn(() => [prompt(1, 'ph')]),
    getEmbeddingCount: vi.fn(() => 0),
    searchSemantic: vi.fn(() => []),
    ...overrides,
  };
}

describe('getProjectContext', () => {
  it('returns accumulated memories and recent interactions when no query is given', async () => {
    const db = store();

    const result = await getProjectContext(db, { project: 'ph', limit: 5 });

    expect(result.project).toBe('ph');
    expect(result.memories).toEqual([memory]);
    expect(result.prompts).toEqual([prompt(1, 'ph')]);
    expect(db.searchMemories).toHaveBeenCalled();
    expect(db.getRecentProjectPrompts).toHaveBeenCalledWith('ph', 5);
  });

  it('fuses text and semantic results when embeddings exist', async () => {
    const matchingPrompt = prompt(8, 'ph');
    const db = store({
      getEmbeddingCount: vi.fn(() => 10),
      search: vi.fn(() => [matchingPrompt]),
      searchSemantic: vi.fn(() => [matchingPrompt]),
    });
    const embed = vi.fn(async () => new Float32Array([0.25, 0.75]));

    const result = await getProjectContext(db, {
      project: 'ph', query: 'sqlite migrations', limit: 3,
      includeMemories: false,
    }, { embed, embedModel: 'nomic-embed-text' });

    expect(embed).toHaveBeenCalledWith('sqlite migrations');
    expect(db.searchSemantic).toHaveBeenCalledWith(new Float32Array([0.25, 0.75]), 9, 'ph', 'nomic-embed-text');
    expect(db.searchMemories).not.toHaveBeenCalled();
    expect(result.prompts).toEqual([matchingPrompt]);
  });

  it('records notes when semantic index is empty and falls back to text', async () => {
    const db = store({
      getEmbeddingCount: vi.fn(() => 0),
      search: vi.fn(() => [prompt(1, 'ph')]),
    });

    const result = await getProjectContext(db, { project: 'ph', query: 'sqlite' });
    expect(result.notes.some(n => n.includes('semantic index is empty'))).toBe(true);
    expect(result.prompts).toHaveLength(1);
  });

  it('renders context with memories and prompt excerpts', () => {
    const context = {
      project: 'ph', memories: [memory], prompts: [prompt(1, 'ph')], notes: [],
    };

    const compact = formatProjectContext(context);
    const verbose = formatProjectContext(context, { includePromptText: true });

    expect(compact).toContain('Project Knowledge: ph');
    expect(compact).toContain('[memory #12 · decision; prompts none recorded] Use local SQLite');
    expect(compact).toContain('### Interaction #1');
    expect(verbose).toContain('```\nprompt 1\n```');
  });
});
