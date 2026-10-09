import { describe, it, expect } from 'vitest';
import { FilterPipeline, FilterResult } from '../index.js';

/**
 * GWT wiring for SPEC-004 (filter pipeline).
 */
describe('FilterPipeline rules (SPEC-004)', () => {
  const pipeline = new FilterPipeline({ minLength: 15, minRelevance: 3 });

  it('rejects too-short prompts (G1)', () => {
    const r = pipeline.check('hello');
    expect(r.keep).toBe(false);
    expect(r.reason).toBe('too_short');
  });

  it('rejects control-char noise (G2)', () => {
    // length check runs first in the full pipeline, so isolate the rule
    const p = new FilterPipeline({ minLength: 1 });
    const r = p.check('\u001b[31m\u0000\u001b[0m');
    expect(r.keep).toBe(false);
    expect(r.reason).toBe('non_printable');
  });

  it('rejects trivial conversational filler (pattern_match)', () => {
    const p = new FilterPipeline({ minLength: 1 });
    for (const filler of ['yes', 'ok', 'continue', 'grazie', 'procedi']) {
      const r = p.check(filler);
      expect(r.keep).toBe(false);
      expect(r.reason).toBe('pattern_match');
    }
  });

  it('rejects orphan code noise (pattern_match)', () => {
    const r = pipeline.check('console.log("x")');
    expect(r.keep).toBe(false);
    expect(r.reason).toBe('pattern_match');
  });

  it('keeps a meaningful prompt', () => {
    const r = pipeline.check('explain goroutines with channels and memory model');
    expect(r.keep).toBe(true);
  });

  it('detects exact duplicates via hashes (G3)', () => {
    const p = new FilterPipeline({ minLength: 1, existingHashes: new Map([[FilterPipeline.hashPrompt('same prompt text'), 42]]) });
    const r = p.check('same prompt text');
    expect(r.keep).toBe(false);
    expect(r.reason).toBe('exact_duplicate');
    expect(r.details).toContain('#42');
  });

  it('registerHash makes subsequent checks duplicates', () => {
    const p = new FilterPipeline({ minLength: 1 });
    p.registerHash('first prompt text', 7);
    const r = p.check('first prompt text');
    expect(r.keep).toBe(false);
    expect(r.reason).toBe('exact_duplicate');
  });

  it('rejects low relevance when analysis is provided (low_relevance)', () => {
    const r = pipeline.check('a sufficiently long but useless prompt text here', { relevance: 1, role: undefined, tags: [], project: undefined, language: undefined, quality: 1, summary: '', key_insights: [], technical_decisions: [] });
    expect(r.keep).toBe(false);
    expect(r.reason).toBe('low_relevance');
  });

  it('skips relevance check when minRelevance is 0', () => {
    const p = new FilterPipeline({ minLength: 1, minRelevance: 0 });
    const r = p.check('long enough prompt text', { relevance: 0, role: undefined, tags: [], project: undefined, language: undefined, quality: 0, summary: '', key_insights: [], technical_decisions: [] });
    expect(r.keep).toBe(true);
  });
});

describe('FilterPipeline short-circuit (SPEC-004)', () => {
  it('rules run before dedup (first failure wins)', () => {
    const p = new FilterPipeline({ minLength: 100, existingHashes: new Map([[FilterPipeline.hashPrompt('short'), 1]]) });
    const r: FilterResult = p.check('short');
    expect(r.reason).toBe('too_short');
  });
});
