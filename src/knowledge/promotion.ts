import type { MemoryEntry, PromptMetadata } from '../types.js';

export interface KnowledgeProposalInput {
  project: string;
  prompt_ids: number[];
  summary: string;
  key_insights: string[];
  technical_decisions: string[];
}

export interface KnowledgePromotionStore {
  getById(id: number): { metadata: string } | undefined;
  promoteMemories(memories: Omit<MemoryEntry, 'id'>[]): number[];
}

/** Validate provenance and atomically persist approved project knowledge. */
export function promoteProjectKnowledge(
  store: KnowledgePromotionStore,
  proposals: KnowledgeProposalInput[],
): number[] {
  for (const proposal of proposals) {
    for (const sourceId of new Set(proposal.prompt_ids)) {
      const prompt = store.getById(sourceId);
      let metadata: PromptMetadata = {};
      try { if (prompt) metadata = JSON.parse(prompt.metadata) as PromptMetadata; } catch {}
      if (!prompt || metadata.project !== proposal.project) {
        throw new Error(`Prompt #${sourceId} does not exist in project "${proposal.project}".`);
      }
    }
  }

  return store.promoteMemories(proposals.map(proposal => {
    const now = new Date().toISOString();
    return {
      ...proposal,
      created_at: now,
      updated_at: now,
      access_count: 0,
    };
  }));
}
