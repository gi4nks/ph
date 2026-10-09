import { describe, it, expect } from 'vitest';
import { parseAnalysisResponse, mergeMetadata } from '../index.js';
import type { AnalysisResult } from '../index.js';

/**
 * GWT wiring for SPEC-006 (analysis pipeline) — pure functions, no LLM.
 */
const fullResult: AnalysisResult = {
  project: 'ph',
  language: 'typescript',
  role: 'refactor',
  tags: ['db', 'migration'],
  relevance: 8,
  quality: 7,
  summary: 'refactored the migration path',
  key_insights: ['response column via ALTER'],
  technical_decisions: ['use ALTER TABLE over recreate'],
};

describe('parseAnalysisResponse (SPEC-006)', () => {
  it('extracts JSON from fenced output (G1)', () => {
    const raw = '```json\n{"role":"debug","relevance":5,"tags":["x"]}\n```';
    const r = parseAnalysisResponse(raw);
    expect(r.role).toBe('debug');
    expect(r.relevance).toBe(5);
  });

  it('extracts the first JSON block from prose (G1 variant)', () => {
    const raw = 'Sure! Here is the analysis:\n{"role":"explain","summary":"s"}\nHope that helps.';
    const r = parseAnalysisResponse(raw);
    expect(r.role).toBe('explain');
    expect(r.summary).toBe('s');
  });

  it('returns {} for non-JSON output without throwing (G2)', () => {
    const r = parseAnalysisResponse('I have no idea what you want');
    expect(r).toEqual({});
  });

  it('handles malformed JSON gracefully (G2)', () => {
    const r = parseAnalysisResponse('{"role": "debug", "tags": [1, 2');
    expect(r).toEqual({});
  });

  it('parses a complete AnalysisResult', () => {
    const raw = JSON.stringify(fullResult);
    const r = parseAnalysisResponse(raw);
    expect(r.role).toBe('refactor');
    expect(r.key_insights).toContain('response column via ALTER');
  });
});

describe('mergeMetadata (SPEC-006)', () => {
  it('preserves manual fields without force (G3)', () => {
    const merged = mergeMetadata({ role: 'manual-role', tags: ['manual'] }, fullResult, false);
    expect(merged.role).toBe('manual-role');
    expect(merged.tags).toEqual(['manual']);
    // absent fields still fill in
    expect(merged.project).toBe('ph');
    expect(merged.relevance).toBe(8);
  });

  it('force overwrites existing fields (G4)', () => {
    const merged = mergeMetadata({ role: 'manual-role', relevance: 1 }, fullResult, true);
    expect(merged.role).toBe('refactor');
    expect(merged.relevance).toBe(8);
  });

  it('fills only defined analysis fields', () => {
    const merged = mergeMetadata({}, { role: 'debug', relevance: undefined, tags: [], project: undefined, language: undefined, quality: undefined, summary: undefined, key_insights: undefined, technical_decisions: undefined }, false);
    expect(merged.role).toBe('debug');
    expect(merged.project).toBeUndefined();
    expect(merged.tags).toBeUndefined();
  });

  it('cleans empty strings set by the LLM', () => {
    const merged = mergeMetadata({}, { role: '', project: '', language: '', tags: [], relevance: undefined, quality: undefined, summary: undefined, key_insights: undefined, technical_decisions: undefined }, false);
    expect(merged.role).toBeUndefined();
    expect(merged.project).toBeUndefined();
  });
});
