import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PhDB } from '../../db/index.js';
import { importClaudeHistory } from '../claude.js';
import { importGeminiHistory } from '../gemini.js';
import { importOpenCodeHistory } from '../opencode.js';
import { importCodexHistory } from '../codex.js';

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
    expect(prompts.map(({ prompt, response, workdir }) => ({ prompt, response, workdir }))).toEqual([
      { prompt: 'Modern Codex rollout format', response: 'Final response.', workdir: '/work/ph' },
      { prompt: 'Second turn', response: 'Second answer.', workdir: '/work/ph' },
      { prompt: 'Explain Codex rollout import', response: 'It reads the session JSONL.', workdir: '/work/ph' },
    ]);
    await importCodexHistory(db, codexDir, false);
    expect(db.getAllPrompts().filter((prompt) => prompt.tool === 'codex')).toHaveLength(3);
  });
});
