import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhDB } from '../../db/index.js';

const { prepareLiveCaptureSpy, completeLiveCaptureSpy } = vi.hoisted(() => ({
  prepareLiveCaptureSpy: vi.fn(),
  completeLiveCaptureSpy: vi.fn(),
}));

vi.mock('../../capture/lifecycle.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../capture/lifecycle.js')>();
  return {
    ...actual,
    prepareLiveCapture: (...args: Parameters<typeof actual.prepareLiveCapture>) => {
      prepareLiveCaptureSpy(...args);
      return actual.prepareLiveCapture(...args);
    },
    completeLiveCapture: (...args: Parameters<typeof actual.completeLiveCapture>) => {
      completeLiveCaptureSpy(...args);
      return actual.completeLiveCapture(...args);
    },
  };
});

import { cmdHook } from '../hook.js';

describe('ph hook', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    prepareLiveCaptureSpy.mockClear();
    completeLiveCaptureSpy.mockClear();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-hook-'));
    dbPath = path.join(dir, 'history.db');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exits quietly on empty or malformed JSON stdin', async () => {
    await expect(cmdHook(dbPath, {}, ['claude'], '')).resolves.toBeUndefined();
    await expect(cmdHook(dbPath, {}, ['gemini'], '{not-json')).resolves.toBeUndefined();
    await expect(cmdHook(dbPath, {}, ['codex'], 'null')).resolves.toBeUndefined();
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it('captures modern Claude JSONL turns with cwd, skips toolUseResult, and deduplicates in O(1)', async () => {
    const getAllSpy = vi.spyOn(PhDB.prototype, 'getAllPromptHashes');
    const transcript = path.join(dir, 'claude-session.jsonl');
    const projectDir = path.join(dir, 'my-hyphen-app');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(projectDir, 'tsconfig.json'), '{}');

    fs.writeFileSync(transcript, [
      JSON.stringify({
        promptId: 'p-1',
        cwd: projectDir,
        timestamp: '2026-11-10T10:00:00.000Z',
        message: { role: 'user', content: 'Inspect the config loader' },
      }),
      JSON.stringify({
        timestamp: '2026-11-10T10:00:01.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Checking config loader.' },
            { type: 'tool_use', id: 'tu-1', name: 'read_file' },
          ],
        },
      }),
      JSON.stringify({
        toolUseResult: { stdout: 'file contents' },
        timestamp: '2026-11-10T10:00:02.000Z',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }] },
      }),
      JSON.stringify({
        timestamp: '2026-11-10T10:00:03.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Done inspecting.' }] },
      }),
    ].join('\n'));

    const payload = JSON.stringify({ transcript_path: transcript });
    await cmdHook(dbPath, {}, ['claude'], payload);
    await cmdHook(dbPath, {}, ['claude'], payload);

    expect(getAllSpy).not.toHaveBeenCalled();

    const db = new PhDB(dbPath);
    try {
      const prompts = db.getAllPrompts();
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toMatchObject({
        tool: 'claude',
        prompt: 'Inspect the config loader',
        response: 'Checking config loader.\nDone inspecting.',
        workdir: projectDir,
      });
      expect(JSON.parse(prompts[0].metadata)).toMatchObject({
        project: 'my-hyphen-app',
        language: 'typescript',
      });
    } finally {
      db.close();
    }
  });

  it('captures Gemini hook payloads and deduplicates in O(1)', async () => {
    const getAllSpy = vi.spyOn(PhDB.prototype, 'getAllPromptHashes');
    const workdir = path.join(dir, 'gemini-proj');
    fs.mkdirSync(workdir, { recursive: true });

    const payload = JSON.stringify({
      prompt: 'Summarize FTS5 indexing',
      prompt_response: 'FTS5 indexes prompt and response columns.',
      cwd: workdir,
      timestamp: '2026-11-10T11:00:00.000Z',
    });

    await cmdHook(dbPath, {}, ['gemini'], payload);
    await cmdHook(dbPath, {}, ['gemini'], payload);

    expect(getAllSpy).not.toHaveBeenCalled();

    const db = new PhDB(dbPath);
    try {
      const prompts = db.getAllPrompts();
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toMatchObject({
        tool: 'gemini',
        prompt: 'Summarize FTS5 indexing',
        response: 'FTS5 indexes prompt and response columns.',
        workdir,
      });
    } finally {
      db.close();
    }
  });

  it('captures new Codex rollout turns incrementally in O(1)', async () => {
    const getAllSpy = vi.spyOn(PhDB.prototype, 'getAllPromptHashes');
    const rollout = path.join(dir, 'rollout-session.jsonl');
    const workdir = path.join(dir, 'codex-app');
    fs.mkdirSync(workdir, { recursive: true });

    const turn1 = [
      JSON.stringify({ timestamp: '2026-11-10T12:00:00.000Z', type: 'session_meta', payload: { id: 's1', cwd: '/synthetic' } }),
      JSON.stringify({ timestamp: '2026-11-10T12:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'First codex turn' }] } }),
      JSON.stringify({ timestamp: '2026-11-10T12:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'First codex reply' }] } }),
    ];
    fs.writeFileSync(rollout, turn1.join('\n'));

    await cmdHook(dbPath, {}, ['codex', '--workdir', workdir], JSON.stringify({ transcript_path: rollout }));

    const turn2 = [
      JSON.stringify({ timestamp: '2026-11-10T12:01:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Second codex turn' }] } }),
      JSON.stringify({ timestamp: '2026-11-10T12:01:02.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Second codex reply' }] } }),
    ];
    fs.writeFileSync(rollout, [...turn1, ...turn2].join('\n'));

    await cmdHook(dbPath, {}, ['codex', '--workdir', workdir], JSON.stringify({ transcript_path: rollout }));

    expect(getAllSpy).not.toHaveBeenCalled();

    const db = new PhDB(dbPath);
    try {
      const prompts = db.getAllPrompts();
      expect(prompts).toHaveLength(2);
      expect(prompts.map((p) => p.prompt).sort()).toEqual(['First codex turn', 'Second codex turn']);
      expect(prompts.every((p) => p.workdir === workdir)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('captures AGY transcripts preferring transcript_full.jsonl and workspacePaths with O(1) dedup', async () => {
    const getAllSpy = vi.spyOn(PhDB.prototype, 'getAllPromptHashes');
    const logsDir = path.join(dir, 'conv', '.system_generated', 'logs');
    const workspace = path.join(dir, 'agy-workspace');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });

    const compactPath = path.join(logsDir, 'transcript.jsonl');
    const fullPath = path.join(logsDir, 'transcript_full.jsonl');

    fs.writeFileSync(compactPath, [
      JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: '<USER_REQUEST>Build the hook</USER_REQUEST>', created_at: '2026-11-10T13:00:00.000Z' }),
      JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', content: 'Truncated', truncated_fields: ['content'] }),
    ].join('\n'));

    fs.writeFileSync(fullPath, [
      JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: '<USER_REQUEST>Build the hook</USER_REQUEST>', created_at: '2026-11-10T13:00:00.000Z' }),
      JSON.stringify({
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        content: 'Full AGY response',
        created_at: '2026-11-10T13:00:04.000Z',
        tool_calls: [{ toolSummary: 'Edit hook' }],
      }),
    ].join('\n'));

    const payload = JSON.stringify({ transcriptPath: compactPath, workspacePaths: [workspace] });
    await cmdHook(dbPath, {}, ['agy'], payload);
    await cmdHook(dbPath, {}, ['agy'], payload);

    expect(getAllSpy).not.toHaveBeenCalled();

    const db = new PhDB(dbPath);
    try {
      const prompts = db.getAllPrompts();
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toMatchObject({
        tool: 'agy',
        prompt: 'Build the hook',
        response: 'Full AGY response',
        workdir: workspace,
      });
      expect(JSON.parse(prompts[0].metadata).tool_calls).toEqual(['Edit hook']);
    } finally {
      db.close();
    }
  });

  it('deduplicates contextually by captureHash across workdirs and responses in O(1)', async () => {
    const getAllSpy = vi.spyOn(PhDB.prototype, 'getAllPromptHashes');
    const getByCaptureHashSpy = vi.spyOn(PhDB.prototype, 'getPromptIdByCaptureHash');
    const repoA = path.join(dir, 'repo-a');
    const repoB = path.join(dir, 'repo-b');
    fs.mkdirSync(repoA, { recursive: true });
    fs.mkdirSync(repoB, { recursive: true });

    const turnRepoA1 = JSON.stringify({
      prompt: 'continue',
      prompt_response: 'Applied fix in repo-a.',
      cwd: repoA,
      timestamp: '2026-11-10T14:00:00.000Z',
    });
    const turnRepoB1 = JSON.stringify({
      prompt: 'continue',
      prompt_response: 'Applied fix in repo-a.',
      cwd: repoB,
      timestamp: '2026-11-10T14:01:00.000Z',
    });
    const turnRepoA2 = JSON.stringify({
      prompt: 'continue',
      prompt_response: 'Updated tests in repo-a.',
      cwd: repoA,
      timestamp: '2026-11-10T14:02:00.000Z',
    });

    await cmdHook(dbPath, {}, ['gemini'], turnRepoA1);
    await cmdHook(dbPath, {}, ['gemini'], turnRepoB1);
    await cmdHook(dbPath, {}, ['gemini'], turnRepoA2);
    // Exact duplicate of first repo-a turn should be skipped in O(1).
    await cmdHook(dbPath, {}, ['gemini'], turnRepoA1);

    expect(getAllSpy).not.toHaveBeenCalled();
    expect(getByCaptureHashSpy).toHaveBeenCalled();

    const db = new PhDB(dbPath);
    try {
      const prompts = db.getAllPrompts();
      expect(prompts).toHaveLength(3);
      expect(prompts.filter((p) => p.workdir === repoA)).toHaveLength(2);
      expect(prompts.filter((p) => p.workdir === repoB)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('schedules live capture follow-up only once on the final inserted turn of a multi-turn batch', async () => {
    const workdir = path.join(dir, 'multi-turn-proj');
    const logsDir = path.join(dir, 'multi-conv', '.system_generated', 'logs');
    fs.mkdirSync(workdir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    const transcriptPath = path.join(logsDir, 'transcript_full.jsonl');
    fs.writeFileSync(transcriptPath, [
      JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: '<USER_REQUEST>Turn one prompt</USER_REQUEST>', created_at: '2026-11-10T15:00:00.000Z' }),
      JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', content: 'Turn one response', created_at: '2026-11-10T15:00:01.000Z' }),
      JSON.stringify({ step_index: 2, type: 'USER_INPUT', content: '<USER_REQUEST>Turn two prompt</USER_REQUEST>', created_at: '2026-11-10T15:01:00.000Z' }),
      JSON.stringify({ step_index: 3, type: 'PLANNER_RESPONSE', content: 'Turn two response', created_at: '2026-11-10T15:01:01.000Z' }),
      JSON.stringify({ step_index: 4, type: 'USER_INPUT', content: '<USER_REQUEST>Turn three prompt</USER_REQUEST>', created_at: '2026-11-10T15:02:00.000Z' }),
      JSON.stringify({ step_index: 5, type: 'PLANNER_RESPONSE', content: 'Turn three response', created_at: '2026-11-10T15:02:01.000Z' }),
    ].join('\n'));

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ imported: 1, skipped: 0, errors: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const cfg = { remoteUrl: 'https://remote.example', remoteApiKey: 'test-key' };
    const payload = JSON.stringify({ transcriptPath, workspacePaths: [workdir] });

    await cmdHook(dbPath, cfg, ['agy'], payload);

    const db = new PhDB(dbPath);
    let lastId: number;
    try {
      const prompts = db.getAllPrompts().sort((a, b) => a.id - b.id);
      expect(prompts).toHaveLength(3);
      lastId = prompts[2].id;

      // Intermediate turns must not retain pending/complete remote sync metadata.
      expect(JSON.parse(prompts[0].metadata).remote_sync_status).toBeUndefined();
      expect(JSON.parse(prompts[1].metadata).remote_sync_status).toBeUndefined();
      expect(JSON.parse(prompts[2].metadata).remote_sync_status).toBe('complete');
    } finally {
      db.close();
    }

    expect(prepareLiveCaptureSpy).toHaveBeenCalledTimes(1);
    expect(prepareLiveCaptureSpy.mock.calls[0]?.[0]?.prompt).toBe('Turn three prompt');
    expect(completeLiveCaptureSpy).toHaveBeenCalledTimes(1);
    expect(completeLiveCaptureSpy).toHaveBeenCalledWith(dbPath, cfg, lastId);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Re-firing with 0 new turns must not schedule any follow-up.
    prepareLiveCaptureSpy.mockClear();
    completeLiveCaptureSpy.mockClear();
    await cmdHook(dbPath, cfg, ['agy'], payload);
    expect(prepareLiveCaptureSpy).not.toHaveBeenCalled();
    expect(completeLiveCaptureSpy).not.toHaveBeenCalled();
  });
});
