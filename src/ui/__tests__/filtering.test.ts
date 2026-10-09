import { describe, expect, it } from 'vitest';
import { applyFilters, buildFilterOptions, toggleFilter } from '../filtering.js';
import type { PromptEntry } from '../../types.js';
import type { ActiveFilters } from '../Header.js';

const entry = (id: number, tool: string, metadata: Record<string, unknown>, prompt = `prompt ${id}`): PromptEntry => ({
  id, timestamp: '2026-10-01T12:00:00.000Z', tool, prompt, response: '', args: '',
  workdir: '/', hostname: 'test', exit_code: 0, metadata: JSON.stringify(metadata),
});

describe('TUI filtering policy', () => {
  it('filters entries by metadata and text using the same metadata parser', () => {
    const entries = [
      entry(1, 'claude', { project: 'ph', role: 'debug', tags: ['sqlite'] }, 'fix sqlite search'),
      entry(2, 'gemini', { project: 'other', role: 'explain' }, 'explain rendering'),
    ];

    expect(applyFilters(entries, { project: 'ph', role: 'debug' }, 'sqlite').map(item => item.id)).toEqual([1]);
    expect(applyFilters(entries, { project: 'missing' }, '').map(item => item.id)).toEqual([]);
  });

  it('builds filter options and counts from the full entry set', () => {
    const entries = [
      entry(1, 'claude', { project: 'ph', role: 'debug', starred: true, quality: 8 }),
      entry(2, 'gemini', { project: 'ph', role: 'explain', quality: 4 }),
      entry(3, 'claude', { project: 'other', role: 'debug', quality: 9 }),
    ];
    const options = buildFilterOptions(entries, { project: 'ph', starred: true } satisfies ActiveFilters);

    expect(options.find(option => option.category === 'project' && option.label === 'ph')?.count).toBe(2);
    expect(options.find(option => option.category === 'starred')?.count).toBe(1);
    expect(options.find(option => option.category === 'quality' && option.label === 'Q ≥ 8')?.count).toBe(2);
    expect(options.find(option => option.category === 'project' && option.label === 'ph')?.active).toBe(true);
  });

  it('toggles and clears project, quality, relevance, and starred selections', () => {
    const option = (category: 'project' | 'quality' | 'relevance' | 'starred', label: string, active: boolean) => ({ category, label, active, count: 1 });
    expect(toggleFilter({ project: 'ph' }, option('project', 'ph', true))).toEqual({});
    expect(toggleFilter({}, option('project', 'lens', false))).toEqual({ project: 'lens' });
    expect(toggleFilter({ minQuality: 7 }, option('quality', 'Q ≥ 7', true))).toEqual({ minQuality: undefined });
    expect(toggleFilter({}, option('relevance', 'R ≥ 5', false))).toEqual({ minRelevance: 5 });
    expect(toggleFilter({}, option('starred', '★ Only starred', false))).toEqual({ starred: true });
  });
});
