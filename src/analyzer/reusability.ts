import { cosineSimilarity } from '../db/index.js';
import type { PromptEntry, PromptMetadata } from '../types.js';

export interface ReusabilityScore {
  id: number;
  prompt: string;
  role: string;
  score: number;
  details: {
    role: number;
    length: number;
    uniqueness: number;
    recency: number;
  };
}

export interface ReusabilityReport {
  total: number;
  keep: ReusabilityScore[];
  review: ReusabilityScore[];
  remove: ReusabilityScore[];
  byRole: Record<string, { keep: number; review: number; remove: number }>;
  duplicates: {
    exact: number;
    variants: number;
  };
}

export interface RemovalCandidate {
  id: number;
  score: number;
  reason: string;
  role: string;
  promptSize: number;
  responseSize: number;
  hasEmbedding: boolean;
}

export class ReusabilityAnalyzer {
  private threshold: number;

  constructor(threshold: number = 0.7) {
    this.threshold = threshold;
  }

  analyze(entries: PromptEntry[], embeddings: Map<number, Float32Array>): ReusabilityReport {
    const scores: ReusabilityScore[] = entries.map(entry => {
      const meta = this.parseMeta(entry.metadata);
      const embedding = embeddings.get(entry.id);

      // Max similarity to any OTHER prompt
      let maxSim = 0;
      if (embedding) {
        for (const [otherId, otherVec] of embeddings.entries()) {
          if (otherId === entry.id) continue;
          const sim = cosineSimilarity(embedding, otherVec);
          if (sim > maxSim) maxSim = sim;
        }
      }

      const roleScore = this.calculateRoleScore(meta.role);
      const lengthScore = this.calculateLengthScore(entry.prompt.length);
      const uniquenessScore = 1 - maxSim;
      const recencyScore = this.calculateRecencyScore(entry.timestamp);

      const finalScore = (
        roleScore * 0.4 +
        lengthScore * 0.2 +
        uniquenessScore * 0.25 +
        recencyScore * 0.15
      ) * 10;

      return {
        id: entry.id,
        prompt: entry.prompt,
        role: meta.role || 'other',
        score: finalScore,
        details: {
          role: roleScore,
          length: lengthScore,
          uniqueness: uniquenessScore,
          recency: recencyScore
        }
      };
    });

    const report: ReusabilityReport = {
      total: entries.length,
      keep: [],
      review: [],
      remove: [],
      byRole: {},
      duplicates: { exact: 0, variants: 0 }
    };

    const keepThreshold = this.threshold * 10;
    const removeThreshold = Math.max(0, this.threshold - 0.3) * 10;

    // Semantic clusters
    for (const s of scores) {
      const uniqueness = s.details.uniqueness;
      const sim = 1 - uniqueness;
      if (sim > 0.95) report.duplicates.exact++;
      else if (sim > 0.85) report.duplicates.variants++;

      if (s.score >= keepThreshold) report.keep.push(s);
      else if (s.score >= removeThreshold) report.review.push(s);
      else report.remove.push(s);

      if (!report.byRole[s.role]) {
        report.byRole[s.role] = { keep: 0, review: 0, remove: 0 };
      }
      if (s.score >= keepThreshold) report.byRole[s.role].keep++;
      else if (s.score >= removeThreshold) report.byRole[s.role].review++;
      else report.byRole[s.role].remove++;
    }

    // Sort keep/remove for top 10
    report.keep.sort((a, b) => b.score - a.score);
    report.remove.sort((a, b) => a.score - b.score);

    return report;
  }

  getRemovalCandidates(entries: PromptEntry[], embeddings: Map<number, Float32Array>, threshold: number = 0.7): RemovalCandidate[] {
    const removeThreshold = Math.max(0, threshold - 0.3) * 10;
    const candidates: RemovalCandidate[] = [];

    // Temporary analyzer with specific threshold
    const tempAnalyzer = new ReusabilityAnalyzer(threshold);
    const report = tempAnalyzer.analyze(entries, embeddings);

    for (const s of report.remove) {
      const entry = entries.find(e => e.id === s.id);
      if (!entry) continue;

      const meta = this.parseMeta(entry.metadata);

      // Don't delete starred prompts
      if (meta.starred) continue;

      const hasEmbedding = embeddings.has(entry.id);

      candidates.push({
        id: s.id,
        score: s.score,
        reason: `score ${s.score.toFixed(1)} < ${removeThreshold.toFixed(1)}`,
        role: s.role,
        promptSize: entry.prompt.length,
        responseSize: (entry.response || '').length,
        hasEmbedding
      });
    }

    return candidates;
  }

  private parseMeta(raw: string): PromptMetadata {
    try {
      return JSON.parse(raw) as PromptMetadata;
    } catch {
      return {};
    }
  }

  private calculateRoleScore(role?: string): number {
    const scores: Record<string, number> = {
      review: 0.9,
      refactor: 0.9,
      architect: 0.9,
      debug: 0.5,
      explain: 0.5,
      generate: 0.2
    };
    return scores[role || ''] || 0.1;
  }

  private calculateLengthScore(length: number): number {
    if (length > 300 && length < 2000) {
      return Math.min(1, Math.max(0, length / 1000));
    }
    return 0.3;
  }

  private calculateRecencyScore(timestamp: string): number {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, 1 - diffDays / 365);
  }

  toCSV(report: ReusabilityReport): string {
    const all = [...report.keep, ...report.review, ...report.remove];
    let csv = 'id,score,role,length,uniqueness,recency,prompt\n';
    for (const s of all) {
      const cleanPrompt = s.prompt.replace(/"/g, '""').replace(/\n/g, ' ');
      csv += `${s.id},${s.score.toFixed(2)},${s.role},${s.prompt.length},${s.details.uniqueness.toFixed(4)},${s.details.recency.toFixed(4)},"${cleanPrompt.slice(0, 100)}"\n`;
    }
    return csv;
  }
}
