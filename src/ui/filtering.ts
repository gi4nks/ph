import type { PromptEntry, PromptMetadata } from '../types.js';
import type { ActiveFilters } from './Header.js';
import { extractTopic } from '../utils/extractTopic.js';

export const FILTER_CATEGORIES = ['project', 'language', 'role', 'tool', 'tag', 'starred', 'quality', 'relevance'] as const;
export type FilterCategory = (typeof FILTER_CATEGORIES)[number];

export const ROLE_COLOR: Record<string, string> = {
  debug: 'red',
  refactor: 'yellow',
  explain: 'blue',
  review: 'magenta',
  architect: 'green',
  test: 'cyan',
  docs: 'white',
  generate: 'green',
  research: 'blue',
};

export function parseMetadata(raw: string): PromptMetadata {
  try { return JSON.parse(raw) as PromptMetadata; } catch { return {}; }
}

const CODEX_RETRY_WINDOW_MS = 2 * 60 * 1000;
const CODEX_RETRY_MIN_PREFIX_LENGTH = 80;

function displayTitle(entry: PromptEntry): string {
  return parseMetadata(entry.metadata).title || extractTopic(entry.prompt);
}

function normalizedPrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, ' ');
}

/** Hide an abandoned Codex prompt when the same request was retried and completed. */
function collapseCodexRetries(entries: PromptEntry[]): PromptEntry[] {
  const buckets = new Map<string, PromptEntry[]>();
  for (const entry of entries) {
    if (entry.tool.toLowerCase() !== 'codex') continue;
    const key = `${entry.workdir}\0${displayTitle(entry)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(entry);
    buckets.set(key, bucket);
  }

  const hidden = new Set<number>();
  for (const bucket of buckets.values()) {
    const incomplete = bucket.filter(entry => !entry.response.trim());
    const completed = bucket.filter(entry => !!entry.response.trim());
    for (const pending of incomplete) {
      const pendingPrompt = normalizedPrompt(pending.prompt);
      if (pendingPrompt.length < CODEX_RETRY_MIN_PREFIX_LENGTH) continue;
      const pendingTime = Date.parse(pending.timestamp);
      if (!Number.isFinite(pendingTime)) continue;

      const retried = completed.some(candidate => {
        const candidateTime = Date.parse(candidate.timestamp);
        const candidatePrompt = normalizedPrompt(candidate.prompt);
        const delta = Math.abs(candidateTime - pendingTime);
        return Number.isFinite(candidateTime)
          && delta <= CODEX_RETRY_WINDOW_MS
          && candidatePrompt.length > pendingPrompt.length
          && candidatePrompt.startsWith(pendingPrompt);
      });
      if (retried) hidden.add(pending.id);
    }
  }

  return hidden.size ? entries.filter(entry => !hidden.has(entry.id)) : entries;
}

function getDistinctValues(entries: PromptEntry[], category: FilterCategory): string[] {
  const values = new Set<string>();
  for (const entry of entries) {
    if (category === 'tool') { values.add(entry.tool); continue; }
    const metadata = parseMetadata(entry.metadata);
    if (category === 'project' && metadata.project) values.add(metadata.project);
    if (category === 'language' && metadata.language) values.add(metadata.language);
    if (category === 'role' && metadata.role) values.add(metadata.role);
    if (category === 'tag') metadata.tags?.forEach(tag => values.add(tag));
  }
  return [...values].sort();
}

export function applyFilters(entries: PromptEntry[], active: ActiveFilters, textFilter: string): PromptEntry[] {
  let result = collapseCodexRetries(entries);
  const hasActiveFilter = Object.values(active).some(value => value !== undefined && value !== false);
  if (hasActiveFilter) {
    result = result.filter(entry => {
      const metadata = parseMetadata(entry.metadata);
      if (active.tool && entry.tool !== active.tool) return false;
      if (active.project && metadata.project !== active.project) return false;
      if (active.language && metadata.language !== active.language) return false;
      if (active.role && metadata.role !== active.role) return false;
      if (active.tag && !metadata.tags?.includes(active.tag)) return false;
      if (active.starred && !metadata.starred) return false;
      if (active.minQuality !== undefined && (metadata.quality ?? 0) < active.minQuality) return false;
      if (active.minRelevance !== undefined && (metadata.relevance ?? 0) < active.minRelevance) return false;
      return true;
    });
  }

  if (textFilter) {
    const query = textFilter.toLowerCase();
    result = result.filter(entry => {
      const metadata = parseMetadata(entry.metadata);
      return entry.prompt.toLowerCase().includes(query)
        || entry.tool.toLowerCase().includes(query)
        || (metadata.project?.toLowerCase().includes(query) ?? false)
        || (metadata.role?.toLowerCase().includes(query) ?? false)
        || (metadata.tags?.some(tag => tag.toLowerCase().includes(query)) ?? false);
    });
  }
  return result;
}

export interface FilterOption {
  category: FilterCategory;
  label: string;
  count: number;
  active: boolean;
}

export function toggleFilter(active: ActiveFilters, option: FilterOption): ActiveFilters {
  if (option.category === 'starred') return { ...active, starred: !option.active || undefined };
  if (option.category === 'quality' || option.category === 'relevance') {
    const value = parseInt(option.label.replace(option.category === 'quality' ? 'Q ≥ ' : 'R ≥ ', ''), 10);
    return option.category === 'quality'
      ? { ...active, minQuality: option.active ? undefined : value }
      : { ...active, minRelevance: option.active ? undefined : value };
  }
  const filterKey = option.category as keyof Omit<ActiveFilters, 'starred' | 'minQuality' | 'minRelevance'>;
  if (option.active) {
    const updated = { ...active };
    delete updated[filterKey];
    return updated;
  }
  return { ...active, [filterKey]: option.label };
}

export function buildFilterOptions(entries: PromptEntry[], active: ActiveFilters): FilterOption[] {
  const options: FilterOption[] = [];
  for (const category of FILTER_CATEGORIES) {
    if (category === 'starred') {
      const count = entries.filter(entry => parseMetadata(entry.metadata).starred).length;
      options.push({ category, label: '★ Only starred', count, active: !!active.starred });
      continue;
    }
    if (category === 'quality' || category === 'relevance') {
      const isQuality = category === 'quality';
      const activeValue = isQuality ? active.minQuality : active.minRelevance;
      const prefix = isQuality ? 'Q ≥ ' : 'R ≥ ';
      options.push({ category, label: `${prefix}${activeValue ?? '?'}`, count: 0, active: activeValue !== undefined });
      for (const value of [1,2,3,4,5,6,7,8,9,10]) {
        const count = entries.filter(entry => {
          const metadata = parseMetadata(entry.metadata);
          return ((isQuality ? metadata.quality : metadata.relevance) ?? 0) >= value;
        }).length;
        options.push({ category, label: `${prefix}${value}`, count, active: activeValue === value });
      }
      continue;
    }

    for (const value of getDistinctValues(entries, category)) {
      const count = entries.filter(entry => {
        const metadata = parseMetadata(entry.metadata);
        if (category === 'project') return metadata.project === value;
        if (category === 'language') return metadata.language === value;
        if (category === 'role') return metadata.role === value;
        if (category === 'tool') return entry.tool === value;
        if (category === 'tag') return metadata.tags?.includes(value) ?? false;
        return false;
      }).length;
      const activeValue = active[category as keyof Omit<ActiveFilters, 'starred' | 'minQuality' | 'minRelevance'>];
      options.push({ category, label: value, count, active: activeValue === value });
    }
  }
  return options;
}
