import { PhDB } from '../db/index.js';
import type { PromptMetadata } from '../types.js';

export interface Stats {
  total: number;
  byTool: Record<string, number>;
  byProject: Record<string, number>;
  byLanguage: Record<string, number>;
  byRole: Record<string, number>;
  analyzed: number;
  starred: number;
  avgRelevance: number;
  avgQuality: number;
}

export function getStats(db: PhDB): Stats {
  const all = db.search({ limit: 1000000 });
  const stats: Stats = {
    total: all.length,
    byTool: {},
    byProject: {},
    byLanguage: {},
    byRole: {},
    analyzed: 0,
    starred: 0,
    avgRelevance: 0,
    avgQuality: 0,
  };

  let totalRel = 0;
  let totalQual = 0;
  let analyzedWithScores = 0;

  for (const entry of all) {
    stats.byTool[entry.tool] = (stats.byTool[entry.tool] ?? 0) + 1;

    let meta: PromptMetadata = {};
    try {
      meta = JSON.parse(entry.metadata) as PromptMetadata;
    } catch {
      // ignore
    }

    if (meta.project) {
      stats.byProject[meta.project] = (stats.byProject[meta.project] ?? 0) + 1;
    }
    if (meta.language) {
      stats.byLanguage[meta.language] = (stats.byLanguage[meta.language] ?? 0) + 1;
    }
    if (meta.role) {
      stats.byRole[meta.role] = (stats.byRole[meta.role] ?? 0) + 1;
      stats.analyzed++;
    }
    if (meta.starred) {
      stats.starred++;
    }

    if (meta.relevance !== undefined || meta.quality !== undefined) {
      totalRel += meta.relevance ?? 0;
      totalQual += meta.quality ?? 0;
      analyzedWithScores++;
    }
  }

  if (analyzedWithScores > 0) {
    stats.avgRelevance = totalRel / analyzedWithScores;
    stats.avgQuality = totalQual / analyzedWithScores;
  }

  return stats;
}
