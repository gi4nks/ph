import { describe, expect, it, vi } from 'vitest';
import { extractAutomaticMemories, parseAutomaticMemories } from '../automatic-memory.js';
import type { PromptEntry } from '../../types.js';

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

  it('tolerates leading and trailing prose around JSON output', () => {
    const prompt = 'Please always use English in PH user-facing documentation.';
    const raw = `Here are the extracted memories:\n\`\`\`json\n${JSON.stringify({ memories: [
      { scope: 'work', kind: 'work-preference', content: 'Write PH user-facing documentation in English.', evidence: 'Please always use English in PH user-facing documentation.', sensitive: false },
    ] })}\n\`\`\`\nDone!`;
    expect(parseAutomaticMemories(raw, prompt)).toEqual([{
      scope: 'work', kind: 'work-preference', content: 'Write PH user-facing documentation in English.',
    }]);
  });

  it('passes structured JSON generation options in extractAutomaticMemories', async () => {
    const entry = {
      id: 1,
      timestamp: '2026-11-01T10:00:00.000Z',
      tool: 'codex',
      prompt: 'Please always use English in PH user-facing documentation.',
      response: 'Understood, using English.',
      args: '',
      workdir: '/tmp/ph',
      hostname: 'test',
      exit_code: 0,
      metadata: '{}',
    } as PromptEntry;
    const generate = vi.fn().mockResolvedValue(JSON.stringify({
      memories: [{
        scope: 'work',
        kind: 'work-preference',
        content: 'Write PH user-facing documentation in English.',
        evidence: 'Please always use English in PH user-facing documentation.',
        sensitive: false,
      }],
    }));

    const result = await extractAutomaticMemories(entry, { name: 'test', generate }, 'ph');

    expect(generate).toHaveBeenCalledWith(expect.any(String), {
      maxOutputTokens: 800,
      think: false,
      format: 'json',
    });
    expect(result).toEqual([{
      scope: 'work',
      kind: 'work-preference',
      content: 'Write PH user-facing documentation in English.',
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
