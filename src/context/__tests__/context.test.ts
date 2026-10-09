import { describe, expect, it, vi } from 'vitest';
import { formatProjectContext, getProjectContext, type ProjectContextStore } from '../index.js';
import type { MemoryEntry, ProjectSummary, PromptEntry } from '../../types.js';

const prompt = (id: number, project: string): PromptEntry => ({
  id, timestamp: '2026-10-01T12:00:00.000Z', tool: 'claude', prompt: `prompt ${id}`,
  response: '', args: '', workdir: `/work/${project}`, hostname: 'test', exit_code: 0,
  metadata: JSON.stringify({ project, summary: `summary ${id}` }),
});

const memory: MemoryEntry = {
  id: 12, project: 'ph', prompt_ids: [1], summary: 'Use local SQLite', key_insights: ['Keep data local'],
  technical_decisions: ['SQLite'], created_at: '2026-10-01T12:00:00.000Z',
  updated_at: '2026-10-01T12:00:00.000Z', access_count: 0,
};

const summary: ProjectSummary = {
  project: 'ph', summary: 'Prompt history tool', key_insights: ['Search old work'],
  technical_decisions: ['Use TypeScript'], prompt_count: 4,
  first_analyzed: '2026-09-01T12:00:00.000Z', last_analyzed: '2026-10-01T12:00:00.000Z',
};

function store(overrides: Partial<ProjectContextStore> = {}): ProjectContextStore {
  return {
    getProjectSummary: vi.fn(() => summary),
    searchMemories: vi.fn(() => [memory]),
    getProjectMemory: vi.fn(() => [prompt(1, 'ph')]),
    searchSemantic: vi.fn(() => []),
    ...overrides,
  };
}

describe('getProjectContext', () => {
  it('returns accumulated knowledge and recent evidence for one project', async () => {
    const db = store();

    const result = await getProjectContext(db, { project: 'ph', limit: 5 });

    expect(result).toEqual({
      project: 'ph',
      summary,
      memories: [memory],
      prompts: [prompt(1, 'ph')],
    });
    expect(db.searchMemories).toHaveBeenCalledWith('ph', 5);
    expect(db.getProjectMemory).toHaveBeenCalledWith('ph', 5);
  });

  it('uses a project-scoped semantic query and skips excluded sources', async () => {
    const matchingPrompt = prompt(8, 'ph');
    const db = store({ searchSemantic: vi.fn(() => [matchingPrompt]) });
    const embed = vi.fn(async () => new Float32Array([0.25, 0.75]));

    const result = await getProjectContext(db, {
      project: 'ph', query: 'sqlite migrations', limit: 3,
      includeSummary: false, includeMemories: false,
    }, embed);

    expect(embed).toHaveBeenCalledWith('sqlite migrations');
    expect(db.searchSemantic).toHaveBeenCalledWith(new Float32Array([0.25, 0.75]), 3, 'ph');
    expect(db.getProjectSummary).not.toHaveBeenCalled();
    expect(db.searchMemories).not.toHaveBeenCalled();
    expect(db.getProjectMemory).not.toHaveBeenCalled();
    expect(result.prompts).toEqual([matchingPrompt]);
  });

  it('returns empty context when every project source has no evidence', async () => {
    const db = store({
      getProjectSummary: vi.fn(() => null),
      searchMemories: vi.fn(() => []),
      getProjectMemory: vi.fn(() => []),
    });

    await expect(getProjectContext(db, { project: 'unknown' })).resolves.toEqual({
      project: 'unknown', summary: null, memories: [], prompts: [],
    });
  });

  it('renders shared evidence with source ids and optional prompt text', () => {
    const context = {
      project: 'ph', summary, memories: [memory], prompts: [prompt(1, 'ph')],
    };

    const compact = formatProjectContext(context);
    const verbose = formatProjectContext(context, { includePromptText: true });
    const agentContext = formatProjectContext(context, { promptExcerptLength: 300, responseExcerptLength: 200 });

    expect(compact).toContain('Project Knowledge: ph');
    expect(compact).toContain('[memory #12] Use local SQLite');
    expect(compact).toContain('### Interaction #1');
    expect(compact).not.toContain('```');
    expect(verbose).toContain('```\nprompt 1\n```');
    expect(agentContext).toContain('Prompt: prompt 1');
  });
});
