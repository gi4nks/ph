import { describe, expect, it } from 'vitest';
import { parseAutomaticMemories } from '../automatic-memory.js';

describe('automatic memory candidate validation', () => {
  it('keeps only durable items with an exact user-prompt quote', () => {
    const prompt = 'Please always use English in PH user-facing documentation.';
    const raw = JSON.stringify({ memories: [
      { scope: 'work', kind: 'work-preference', content: 'Write PH user-facing documentation in English.', evidence: 'Please always use English in PH user-facing documentation.', sensitive: false },
      { scope: 'project', kind: 'project-decision', content: 'PH uses a separate memory hub key.', evidence: 'The hub uses a separate key.', sensitive: false },
    ] });
    expect(parseAutomaticMemories(raw, prompt)).toEqual([{
      scope: 'work', kind: 'work-preference', content: 'Write PH user-facing documentation in English.',
    }]);
  });

  it('rejects sensitive, assistant-only, malformed, and personal candidates', () => {
    const prompt = 'Always use English in PH documentation.';
    const raw = JSON.stringify({ memories: [
      { scope: 'work', kind: 'work-preference', content: 'The user has a medical condition they want remembered.', evidence: 'Always use English in PH documentation.', sensitive: false },
      { scope: 'project', kind: 'project-decision', content: 'Use a new hosting service for PH.', evidence: 'Assistant proposed a new hosting service.', sensitive: false },
      { scope: 'personal', kind: 'work-preference', content: 'Always use English in PH documentation.', evidence: prompt, sensitive: false },
    ] });
    expect(parseAutomaticMemories(raw, prompt)).toEqual([]);
  });
});
