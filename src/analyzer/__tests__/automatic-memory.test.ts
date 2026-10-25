import { describe, expect, it } from 'vitest';
import { parseAutomaticMemories } from '../automatic-memory.js';

describe('automatic memory extraction policy', () => {
  it('keeps only directly supported normal work preferences and project decisions', () => {
    const prompt = 'Please keep technical answers concise. For this project, use SQLite as the canonical local store.';
    const candidates = parseAutomaticMemories(JSON.stringify({ memories: [
      { scope: 'work', kind: 'work-preference', content: 'Keep technical explanations concise and direct.', evidence: 'keep technical answers concise', sensitive: false },
      { scope: 'personal', kind: 'work-preference', content: 'Lives in Zurich and prefers quiet evenings.', evidence: 'keep technical answers concise', sensitive: false },
      { scope: 'project', kind: 'project-decision', content: 'Use SQLite as the canonical local store.', evidence: 'use SQLite as the canonical local store', sensitive: false },
    ] }), prompt);
    expect(candidates).toEqual([
      { scope: 'work', kind: 'work-preference', content: 'Keep technical explanations concise and direct.' },
      { scope: 'project', kind: 'project-decision', content: 'Use SQLite as the canonical local store.' },
    ]);
  });

  it('rejects anything labeled sensitive, credential-like, malformed, or generic', () => {
    const prompt = 'Save no secrets, health facts, or generic facts in memory.';
    expect(parseAutomaticMemories(JSON.stringify({ memories: [
      { scope: 'work', kind: 'work-preference', content: 'The API key is sk-12345678901234567890', evidence: 'Save no secrets, health facts', sensitive: false },
      { scope: 'work', kind: 'work-preference', content: 'User has a medical diagnosis of migraine.', evidence: 'Save no secrets, health facts', sensitive: true },
      { scope: 'project', kind: 'project-decision', content: 'This is a generic fact with enough length.', evidence: 'Save no secrets, health facts', sensitive: false },
    ] }), prompt)).toEqual([]);
    expect(parseAutomaticMemories(JSON.stringify({ memories: [{
      scope: 'work', kind: 'work-preference', content: 'Use gianluca@example.com as the account contact.', evidence: 'Save no secrets, health facts', sensitive: false,
    }] }), 'Save no secrets, health facts; use gianluca@example.com for contact.')).toEqual([]);
    expect(parseAutomaticMemories('not json', prompt)).toEqual([]);
    expect(parseAutomaticMemories(JSON.stringify({ memories: [{
      scope: 'project', kind: 'project-decision', content: 'Use SQLite as the canonical local store.', evidence: 'The assistant suggested SQLite.', sensitive: false,
    }] }), prompt)).toEqual([]);
  });
});
