import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PhDB } from '../../db/index.js';
import { cmdImport } from '../../commands/import.js';
import { importClaudeHistory } from '../claude.js';
import { importGeminiHistory } from '../gemini.js';
import { importOpenCodeHistory } from '../opencode.js';
import { importCodexHistory } from '../codex.js';
import { importAgyHistory, parseAgyTranscript } from '../agy.js';

describe('history import formats', () => {
  let dir: string;
  let db: PhDB;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-import-'));
    db = new PhDB(path.join(dir, 'ph.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('imports a Claude JSONL user/assistant pair with project metadata', async () => {
    const claudeDir = path.join(dir, 'claude');
    const project = path.join(claudeDir, 'projects', '-tmp-ph');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'session.jsonl'), [
      JSON.stringify({ type: 'user', content: 'Explain the importer behavior', timestamp: '2026-10-09T10:00:00.000Z' }),
      JSON.stringify({ type: 'assistant', content: [{ type: 'thinking', text: 'hidden reasoning' }, { type: 'text', text: 'It pairs transcript messages.' }], timestamp: '2026-10-09T10:00:02.000Z' }),
    ].join('\n'));

    const result = await importClaudeHistory(db, claudeDir, false);
    const [prompt] = db.getAllPrompts();
    expect(result).toMatchObject({ filesScanned: 1, promptsFound: 1, promptsImported: 1, skipped: 0 });
    expect(prompt).toMatchObject({ prompt: 'Explain the importer behavior', response: 'It pairs transcript messages.' });
    expect(prompt.workdir).toBe('/tmp/ph');
    expect(JSON.parse(prompt.metadata)).toMatchObject({ title: 'Explain the importer behavior' });
  });

  it('imports a Gemini session pair and retains its response', async () => {
    const geminiDir = path.join(dir, 'gemini');
    const sessionDir = path.join(geminiDir, 'tmp', 'project-hash', 'chats');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'session-test.json'), JSON.stringify({ messages: [
      { type: 'human', content: [{ text: 'How do I scope vector search?' }], timestamp: '2026-10-09T11:00:00.000Z' },
      { type: 'model', content: 'Filter metadata before limiting candidates.', timestamp: '2026-10-09T11:00:03.000Z' },
    ] }));

    const result = await importGeminiHistory(db, geminiDir, false);
    const [prompt] = db.getAllPrompts();
    expect(result).toMatchObject({ filesScanned: 1, promptsFound: 1, promptsImported: 1 });
    expect(prompt).toMatchObject({ prompt: 'How do I scope vector search?', response: 'Filter metadata before limiting candidates.' });
  });

  it('imports OpenCode messages linked by parentID and preserves the session directory', async () => {
    const storageDir = path.join(dir, 'opencode', 'storage');
    fs.mkdirSync(storageDir, { recursive: true });
    const source = new Database(path.join(dir, 'opencode', 'opencode.db'));
    source.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, time_created INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT);
    `);
    source.prepare('INSERT INTO session VALUES (?, ?, ?)').run('s1', '/work/ph', 1000);
    source.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run('u1', 's1', JSON.stringify({ role: 'user', time: { created: 1000 } }), 1000);
    source.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run('a1', 's1', JSON.stringify({ role: 'assistant', parentID: 'u1', time: { created: 1001 } }), 1001);
    source.prepare('INSERT INTO part VALUES (?, ?, ?)').run('p1', 'u1', JSON.stringify({ type: 'text', text: 'How does OpenCode pairing work?' }));
    source.prepare('INSERT INTO part VALUES (?, ?, ?)').run('p2', 'a1', JSON.stringify({ type: 'text', text: 'Assistant messages link to a parent ID.' }));
    source.close();

    const result = await importOpenCodeHistory(db, storageDir, false);
    const [prompt] = db.getAllPrompts();
    expect(result).toMatchObject({ filesScanned: 1, promptsFound: 1, promptsImported: 1 });
    expect(prompt).toMatchObject({ prompt: 'How does OpenCode pairing work?', response: 'Assistant messages link to a parent ID.', workdir: '/work/ph' });

    const dbOverride = new PhDB(path.join(dir, 'ph-override.db'));
    try {
      const overrideResult = await importOpenCodeHistory(
        dbOverride,
        dir,
        false,
        undefined,
        undefined,
        undefined,
        path.join(dir, 'opencode', 'opencode.db'),
        '/custom/workdir'
      );
      const [overridePrompt] = dbOverride.getAllPrompts();
      expect(overrideResult).toMatchObject({ filesScanned: 1, promptsFound: 1, promptsImported: 1 });
      expect(overridePrompt.workdir).toBe('/custom/workdir');
    } finally {
      dbOverride.close();
    }
  });

  it('imports Codex rollout user messages with their assistant response and cwd', async () => {
    const codexDir = path.join(dir, 'codex');
    const sessions = path.join(codexDir, 'sessions', '2026', '10', '09');
    fs.mkdirSync(sessions, { recursive: true });
    const transcript = path.join(sessions, 'rollout-test-session.jsonl');
    fs.writeFileSync(transcript, [
      JSON.stringify({ timestamp: '2026-10-09T12:00:00.000Z', type: 'session_meta', payload: { id: 'session-1', cwd: '/work/ph' } }),
      JSON.stringify({ timestamp: '2026-10-09T12:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Explain Codex rollout import' } }),
      JSON.stringify({ timestamp: '2026-10-09T12:00:02.000Z', type: 'event_msg', payload: { type: 'agent_message', message: 'It reads the session JSONL.' } }),
      JSON.stringify({ timestamp: '2026-10-09T12:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'It reads the session JSONL.' }] } }),
      JSON.stringify({ timestamp: '2026-10-09T12:00:03.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Second turn' } }),
      JSON.stringify({ timestamp: '2026-10-09T12:00:04.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Second answer.' }] } }),
      JSON.stringify({ timestamp: '2026-10-09T12:00:05.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Modern Codex rollout format' }] } }),
      JSON.stringify({ timestamp: '2026-10-09T12:00:06.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Working on it.' }] } }),
      JSON.stringify({ timestamp: '2026-10-09T12:00:07.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Final response.' }] } }),
    ].join('\n'));

    const result = await importCodexHistory(db, codexDir, false);
    const prompts = db.getAllPrompts().filter((prompt) => prompt.tool === 'codex');
    expect(result).toMatchObject({ filesScanned: 1, promptsFound: 3, promptsImported: 3, skipped: 0 });
    expect(result.importedIds).toHaveLength(3);
    expect(prompts.map(({ prompt, response, workdir }) => ({ prompt, response, workdir }))).toEqual([
      { prompt: 'Modern Codex rollout format', response: 'Final response.', workdir: '/work/ph' },
      { prompt: 'Second turn', response: 'Second answer.', workdir: '/work/ph' },
      { prompt: 'Explain Codex rollout import', response: 'It reads the session JSONL.', workdir: '/work/ph' },
    ]);
    await importCodexHistory(db, codexDir, false);
    expect(db.getAllPrompts().filter((prompt) => prompt.tool === 'codex')).toHaveLength(3);
  });

  it('uses the hook working directory when a Codex transcript has a synthetic cwd', async () => {
    const codexDir = path.join(dir, 'codex');
    const transcript = path.join(dir, 'rollout-hook.jsonl');
    const projectDir = path.join(dir, 'real-project');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'package.json'), '{}');
    fs.writeFileSync(transcript, [
      JSON.stringify({ type: 'session_meta', payload: { cwd: '/synthetic/codex-project' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Find this project later' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Saved with the active project path.' }] } }),
    ].join('\n'));

    await importCodexHistory(db, codexDir, false, undefined, undefined, undefined, transcript, projectDir);
    const [entry] = db.getAllPrompts();
    expect(entry.workdir).toBe(projectDir);
    expect(JSON.parse(entry.metadata).project).toBe('real-project');
  });

  it('imports Antigravity transcript steps with full transcript fallback and project extraction', async () => {
    const agyDir = path.join(dir, 'agy-home');
    const projectDir = path.join(dir, 'my-app');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'package.json'), '{}');
    const convDir = path.join(agyDir, 'brain', 'conv-123', '.system_generated', 'logs');
    fs.mkdirSync(convDir, { recursive: true });

    const compact = [
      JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'What is Antigravity?', created_at: '2026-11-04T12:00:00.000Z' }),
      JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', content: 'Truncated...', truncated_fields: ['content'], created_at: '2026-11-04T12:00:05.000Z' }),
    ].join('\n');

    const full = [
      JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'What is Antigravity?', created_at: '2026-11-04T12:00:00.000Z' }),
      JSON.stringify({
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        content: 'Antigravity is an agentic AI coding environment.',
        created_at: '2026-11-04T12:00:05.000Z',
        tool_calls: [{ toolSummary: 'Workspace inspection' }],
      }),
    ].join('\n');

    fs.writeFileSync(path.join(convDir, 'transcript.jsonl'), compact);
    fs.writeFileSync(path.join(convDir, 'transcript_full.jsonl'), full);

    const result = await importAgyHistory(db, agyDir, false, undefined, undefined, undefined, undefined, projectDir);
    expect(result).toMatchObject({ filesScanned: 1, promptsFound: 1, promptsImported: 1, skipped: 0 });

    const prompts = db.getAllPrompts().filter((p) => p.tool === 'agy');
    expect(prompts).toHaveLength(1);
    expect(prompts[0].prompt).toBe('What is Antigravity?');
    expect(prompts[0].response).toBe('Antigravity is an agentic AI coding environment.');
    expect(prompts[0].workdir).toBe(projectDir);
    const meta = JSON.parse(prompts[0].metadata);
    expect(meta.project).toBe('my-app');
    expect(meta.tool_calls).toEqual(['Workspace inspection']);
  });

  it('imports modern Claude JSONL preserving hyphenated cwd and skipping intermediate tool_use/toolUseResult records', async () => {
    const claudeDir = path.join(dir, 'claude-modern');
    const projectDir = path.join(dir, 'my-hyphen-project');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(projectDir, 'tsconfig.json'), '{}');

    const slugDir = path.join(claudeDir, 'projects', '-tmp-my-hyphen-project');
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, 'session.jsonl'), [
      JSON.stringify({
        promptId: 'prompt-1',
        cwd: projectDir,
        timestamp: '2026-11-05T10:00:00.000Z',
        message: { role: 'user', content: 'Fix the hyphenated workdir' },
      }),
      JSON.stringify({
        timestamp: '2026-11-05T10:00:01.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Reading the file.' },
            { type: 'tool_use', id: 'call-1', name: 'read_file' },
          ],
        },
      }),
      JSON.stringify({
        toolUseResult: { content: 'tool output' },
        timestamp: '2026-11-05T10:00:02.000Z',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'ok' }] },
      }),
      JSON.stringify({
        timestamp: '2026-11-05T10:00:03.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Updated cwd handling.' }] },
      }),
    ].join('\n'));

    const result = await importClaudeHistory(db, claudeDir, false);
    const prompts = db.getAllPrompts().filter((p) => p.tool === 'claude');
    expect(result).toMatchObject({ filesScanned: 1, promptsFound: 1, promptsImported: 1 });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      prompt: 'Fix the hyphenated workdir',
      response: 'Reading the file.\nUpdated cwd handling.',
      workdir: projectDir,
    });
    expect(JSON.parse(prompts[0].metadata)).toMatchObject({
      project: 'my-hyphen-project',
      language: 'typescript',
    });
  });

  it('does not leak process.cwd() during AGY backfill without workdirOverride and parses workspace headers when present', async () => {
    const agyDir = path.join(dir, 'agy-backfill');
    const convNoHeader = path.join(agyDir, 'brain', 'conv-no-header', '.system_generated', 'logs');
    const convWithHeader = path.join(agyDir, 'brain', 'conv-with-header', '.system_generated', 'logs');
    fs.mkdirSync(convNoHeader, { recursive: true });
    fs.mkdirSync(convWithHeader, { recursive: true });

    const noHeaderTranscript = path.join(convNoHeader, 'transcript.jsonl');
    fs.writeFileSync(noHeaderTranscript, [
      JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'Prompt without workspace metadata', created_at: '2026-11-05T11:00:00.000Z' }),
      JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', content: 'Reply without workspace', created_at: '2026-11-05T11:00:01.000Z' }),
    ].join('\n'));

    const withHeaderTranscript = path.join(convWithHeader, 'transcript.jsonl');
    fs.writeFileSync(withHeaderTranscript, [
      JSON.stringify({
        step_index: 0,
        type: 'USER_INPUT',
        content: 'Active Workspaces:\n- /repos/historical-app\n<USER_REQUEST>Prompt with workspace header</USER_REQUEST>',
        created_at: '2026-11-05T12:00:00.000Z',
      }),
      JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', content: 'Reply with workspace', created_at: '2026-11-05T12:00:01.000Z' }),
    ].join('\n'));

    expect(parseAgyTranscript(noHeaderTranscript).interactions[0]?.workdir).toBe('');
    expect(parseAgyTranscript(withHeaderTranscript).interactions[0]?.workdir).toBe('/repos/historical-app');

    const result = await importAgyHistory(db, agyDir, false);
    expect(result).toMatchObject({ filesScanned: 2, promptsFound: 2, promptsImported: 2 });
    const prompts = db.getAllPrompts().filter((p) => p.tool === 'agy');
    const byPrompt = new Map(prompts.map((p) => [p.prompt, p.workdir]));
    expect(byPrompt.get('Prompt without workspace metadata')).toBe('');
    expect(byPrompt.get('Prompt without workspace metadata')).not.toBe(process.cwd());
    expect(byPrompt.get('Prompt with workspace header')).toBe('/repos/historical-app');
  });

  it('deduplicates single-file cmdImport contextually by captureHash without loading all prompt hashes', async () => {
    const getAllSpy = vi.spyOn(PhDB.prototype, 'getAllPromptHashes');
    const getByCaptureHashSpy = vi.spyOn(PhDB.prototype, 'getPromptIdByCaptureHash');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      const repoA = path.join(dir, 'repo-a');
      const repoB = path.join(dir, 'repo-b');
      fs.mkdirSync(repoA, { recursive: true });
      fs.mkdirSync(repoB, { recursive: true });

      const rolloutA = path.join(dir, 'rollout-a.jsonl');
      fs.writeFileSync(rolloutA, [
        JSON.stringify({ type: 'session_meta', payload: { id: 's-a', cwd: repoA } }),
        JSON.stringify({ timestamp: '2026-11-10T10:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'continue' }] } }),
        JSON.stringify({ timestamp: '2026-11-10T10:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Response in repo A' }] } }),
        JSON.stringify({ timestamp: '2026-11-10T10:01:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'continue' }] } }),
        JSON.stringify({ timestamp: '2026-11-10T10:01:02.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Second response in repo A' }] } }),
      ].join('\n'));

      const rolloutB = path.join(dir, 'rollout-b.jsonl');
      fs.writeFileSync(rolloutB, [
        JSON.stringify({ type: 'session_meta', payload: { id: 's-b', cwd: repoB } }),
        JSON.stringify({ timestamp: '2026-11-10T11:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'continue' }] } }),
        JSON.stringify({ timestamp: '2026-11-10T11:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Response in repo A' }] } }),
      ].join('\n'));

      await cmdImport(db, {}, ['codex', '--file', rolloutA, '--workdir', repoA]);
      await cmdImport(db, {}, ['codex', '--file', rolloutB, '--workdir', repoB]);
      // Re-importing rolloutA in the same workdir should skip both turns in O(1).
      await cmdImport(db, {}, ['codex', '--file', rolloutA, '--workdir', repoA]);

      expect(getAllSpy).not.toHaveBeenCalled();
      expect(getByCaptureHashSpy).toHaveBeenCalled();

      const prompts = db.getAllPrompts().filter((p) => p.tool === 'codex');
      expect(prompts).toHaveLength(3);
      expect(prompts.filter((p) => p.workdir === repoA)).toHaveLength(2);
      expect(prompts.filter((p) => p.workdir === repoB)).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
