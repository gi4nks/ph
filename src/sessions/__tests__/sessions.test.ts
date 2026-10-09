import { describe, it, expect } from 'vitest';
import { groupIntoSessions } from '../index.js';
import type { PromptEntry } from '../../types.js';

/**
 * GWT wiring for SPEC-014 (sessions) — time-gap splitting, no cohesion needed.
 */
function entry(timestamp: string): PromptEntry {
  return {
    id: Math.floor(Math.random() * 1e6),
    timestamp,
    tool: 'claude',
    prompt: 'some prompt text of sufficient length',
    response: '',
    args: '',
    workdir: '/p',
    hostname: 'h',
    exit_code: 0,
    metadata: '{}',
  };
}

describe('groupIntoSessions (SPEC-014)', () => {
  it('splits sessions on gaps larger than gapHours (G1)', () => {
    const sessions = groupIntoSessions([
      entry('2026-08-08T10:00:00.000Z'),
      entry('2026-08-08T13:30:00.000Z'), // 3.5h gap > 2h
    ], 2);
    expect(sessions).toHaveLength(2);
  });

  it('keeps prompts within the gap window in one session (G2)', () => {
    const sessions = groupIntoSessions([
      entry('2026-08-08T10:00:00.000Z'),
      entry('2026-08-08T11:30:00.000Z'), // 1.5h gap < 2h
    ], 2);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].entries).toHaveLength(2);
  });

  it('groups multiple prompts into their sessions', () => {
    const sessions = groupIntoSessions([
      entry('2026-08-08T09:00:00.000Z'),
      entry('2026-08-08T09:30:00.000Z'),
      entry('2026-08-08T15:00:00.000Z'),
      entry('2026-08-08T15:20:00.000Z'),
    ], 2);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].entries).toHaveLength(2);
    expect(sessions[1].entries).toHaveLength(2);
  });

  it('handles an empty list', () => {
    expect(groupIntoSessions([], 2)).toEqual([]);
  });

  it('handles a single prompt', () => {
    const sessions = groupIntoSessions([entry('2026-08-08T10:00:00.000Z')], 2);
    expect(sessions).toHaveLength(1);
  });
});
