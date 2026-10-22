import { describe, expect, it } from 'vitest';
import { parseKnowledgeProposals } from '../close.js';

describe('knowledge proposal parsing', () => {
  it('accepts fenced JSON and normalizes lists', () => {
    expect(parseKnowledgeProposals('```json\n{"proposals":[{"summary":" Keep WAL ","key_insights":[" Local "],"technical_decisions":[],"source_prompt_ids":[4]}]}\n```', [4]))
      .toEqual([{ summary: 'Keep WAL', key_insights: ['Local'], technical_decisions: [], source_prompt_ids: [4] }]);
  });

  it('rejects malformed provider output', () => {
    expect(() => parseKnowledgeProposals('{"items":[]}')).toThrow('proposals array');
    expect(() => parseKnowledgeProposals('{"proposals":[{}]}')).toThrow('no summary');
    expect(() => parseKnowledgeProposals('{"proposals":[{"summary":"x","source_prompt_ids":[9]}]}', [4])).toThrow('cite selected source');
  });
});
