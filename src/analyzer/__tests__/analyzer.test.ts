import { describe, it, expect, vi } from 'vitest';
import { analyzeAll, analyzePromptDetailed, parseAnalysisResponse, mergeMetadata } from '../index.js';
import type { AnalysisResult } from '../index.js';
import type { PhDB } from '../../db/index.js';
import type { PromptEntry } from '../../types.js';

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

describe('analyzePromptDetailed', () => {
  it('disables hidden reasoning and requests JSON for simple Ollama analysis', async () => {
    let received: { maxOutputTokens?: number; think?: boolean; format?: 'json' } | undefined;
    const provider = {
      name: 'Ollama (test)',
      generate: async (_prompt: string, options?: typeof received) => {
        received = options;
        return JSON.stringify(fullResult);
      },
    };

    await expect(analyzePromptDetailed('synthetic interaction', provider)).resolves.toEqual({ result: fullResult });
    expect(received).toEqual({ maxOutputTokens: 800, think: false, format: 'json' });
  });

  it('preserves an MLX memory rejection as a safe diagnostic category', async () => {
    const provider = {
      name: 'MLX-Serve (test)',
      generate: async () => { throw new Error('Not enough free memory to load model: needs 9.2 GB but only 7.4 GB is available'); },
    };

    await expect(analyzePromptDetailed('test prompt', provider)).resolves.toEqual({
      result: {},
      error: 'provider_out_of_memory',
    });
  });

  it('classifies oMLX HTTP 507 dynamic memory ceiling rejections as out of memory', async () => {
    const rejection = Object.assign(
      new Error("Model 'gemma-4-12B-it-oQ4e-mtp' (7.89GB) does not fit under the dynamic memory ceiling (5.39GB)."),
      { statusCode: 507 },
    );
    const provider = { name: 'oMLX (test)', generate: async () => { throw rejection; } };

    await expect(analyzePromptDetailed('test prompt', provider)).resolves.toEqual({
      result: {},
      error: 'provider_out_of_memory',
    });
  });

  it('classifies oMLX HTTP 400 requests rejected by the memory ceiling as out of memory', async () => {
    const rejection = Object.assign(
      new Error('Requested context length exceeds the memory ceiling'),
      { statusCode: 400 },
    );
    const provider = { name: 'oMLX (test)', generate: async () => { throw rejection; } };

    await expect(analyzePromptDetailed('test prompt', provider)).resolves.toEqual({
      result: {},
      error: 'provider_out_of_memory',
    });
  });

  it('distinguishes a successful request with unusable model output', async () => {
    const provider = { name: 'test', generate: async () => 'not JSON' };

    await expect(analyzePromptDetailed('test prompt', provider)).resolves.toEqual({
      result: {},
      error: 'analysis_response_invalid',
    });
  });
});

describe('analyzeAll dry-run', () => {
  it('reports a successful analysis without persisting metadata', async () => {
    const entry = { id: 7, prompt: 'synthetic interaction', metadata: '{}' } as PromptEntry;
    const db = { updateMetadataFields: vi.fn(), deleteById: vi.fn() } as unknown as PhDB;
    const provider = { name: 'test', generate: async () => JSON.stringify(fullResult) };

    const result = await analyzeAll([entry], provider, db, { dryRun: true });

    expect(result.updated).toBe(1);
    expect(db.updateMetadataFields).not.toHaveBeenCalled();
    expect(db.deleteById).not.toHaveBeenCalled();
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
