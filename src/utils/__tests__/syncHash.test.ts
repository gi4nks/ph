import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { syncHash } from '../syncHash.js';

/**
 * GWT wiring for SPEC-010 (sync dedup key) — ISSUE-012.
 */
describe('syncHash (SPEC-010)', () => {
  it('is deterministic for identical entries', () => {
    const a = { tool: 'claude', prompt: 'p', response: 'r', args: '' };
    expect(syncHash(a)).toBe(syncHash(a));
  });

  it('differs when args differ (ISSUE-012 fix)', () => {
    const base = { tool: 'claude', prompt: 'same prompt', response: 'same response' };
    expect(syncHash({ ...base, args: '--verbose' })).not.toBe(syncHash({ ...base, args: '--quiet' }));
  });

  it('matches the old 3-field hash when args are empty', () => {
    // regression: entries synced before the args fix keep the same key when
    // args was already '' — the previous format was tool|prompt|response
    const legacy = createHash('sha256').update('claude|p|r').digest('hex');
    expect(syncHash({ tool: 'claude', prompt: 'p', response: 'r', args: '' })).toBe(legacy);
  });

  it('is a 64-char hex string', () => {
    expect(syncHash({ tool: 'a', prompt: 'b', response: 'c' })).toMatch(/^[0-9a-f]{64}$/);
  });
});
