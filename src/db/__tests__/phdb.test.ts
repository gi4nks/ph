import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PhDB } from '../index.js';

/**
 * GWT wiring for SPEC-002 (database), SPEC-005 (search), SPEC-007 (memory),
 * SPEC-009 (archive), SPEC-010 (sync dedup) — deterministic, no network.
 */
describe('PhDB basics (SPEC-002)', () => {
  let dir: string;
  let db: PhDB;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-test-'));
    db = new PhDB(path.join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const entry = (over: Partial<Parameters<PhDB['insert']>[0]> = {}) => ({
    timestamp: '2026-08-08T10:00:00.000Z',
    tool: 'claude',
    prompt: 'explain goroutines in detail with examples',
    args: '',
    workdir: '/proj',
    hostname: 'test-host',
    exit_code: 0,
    metadata: '{}',
    ...over,
  });

  it('insert + getById roundtrip (G1)', () => {
    const id = db.insert(entry());
    const row = db.getById(id);
    expect(row).toBeDefined();
    expect(row?.prompt).toBe('explain goroutines in detail with examples');
    expect(db.getPromptCount()).toBe(1);
  });

  it('insert without response defaults to empty string (G2)', () => {
    const id = db.insert(entry());
    expect(db.getById(id)?.response).toBe('');
  });

  it('insert with response keeps it', () => {
    const id = db.insert(entry({ response: 'goroutines are lightweight threads' }));
    expect(db.getById(id)?.response).toBe('goroutines are lightweight threads');
  });

  it('delete removes the row (G4)', () => {
    const id = db.insert(entry());
    db.delete(id);
    expect(db.getById(id)).toBeUndefined();
    expect(db.getPromptCount()).toBe(0);
  });

  it('getStats is consistent (G5)', () => {
    db.insert(entry({ tool: 'claude' }));
    db.insert(entry({ tool: 'gemini', prompt: 'a completely different prompt about rust lifetimes' }));
    const stats = db.getStats();
    expect(stats.total).toBe(2);
    expect(stats.totalMemories).toBe(0);
    expect(stats.byTool.find(t => t.tool === 'claude')?.count).toBe(1);
    expect(stats.byTool.find(t => t.tool === 'gemini')?.count).toBe(1);
  });

  it('opens with a vec0 embedding table (G6)', () => {
    const vecInfo = db['getAllEmbeddings']();
    expect(vecInfo).toBeInstanceOf(Map);
  });
});

describe('PhDB search (SPEC-005)', () => {
  let dir: string;
  let db: PhDB;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-search-'));
    db = new PhDB(path.join(dir, 'test.db'));
    db.insert({
      timestamp: '2026-08-08T10:00:00.000Z', tool: 'claude', prompt: 'explain goroutines with channels',
      response: 'goroutines are cheap', args: '', workdir: '/a', hostname: 'h', exit_code: 0,
      metadata: JSON.stringify({ project: 'go-play', language: 'go', role: 'explain', tags: ['concurrency'] }),
    });
    db.insert({
      timestamp: '2026-08-08T11:00:00.000Z', tool: 'gemini', prompt: 'how does react rendering work',
      response: 'virtual dom diffing', args: '', workdir: '/b', hostname: 'h', exit_code: 0,
      metadata: JSON.stringify({ project: 'web', language: 'typescript', role: 'explain', tags: ['react'] }),
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('FTS text query returns only matching entries (G1)', () => {
    const results = db.search({ query: 'goroutines', limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].tool).toBe('claude');
  });

  it('scan path with tool filter, no query (G2)', () => {
    const results = db.search({ tool: 'gemini', limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].prompt).toContain('react');
  });

  it('project filter via json_extract (G3)', () => {
    const results = db.search({ project: 'go-play', limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].prompt).toContain('goroutines');
  });

  it('role filter (G3 variant)', () => {
    const results = db.search({ role: 'explain', limit: 10 });
    expect(results).toHaveLength(2);
  });

  it('tag filter matches the serialized tags array (G4)', () => {
    const results = db.search({ tag: 'react', limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].tool).toBe('gemini');
  });

  it('since filter excludes older entries (G5)', () => {
    const results = db.search({ since: new Date('2026-08-08T10:30:00Z'), limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].tool).toBe('gemini');
  });

  it('combined filters narrow correctly', () => {
    const results = db.search({ tool: 'claude', role: 'explain', limit: 10 });
    expect(results).toHaveLength(1);
  });

  it('semantic project filter applies before the nearest-neighbor limit', () => {
    const projectPrompt = db.search({ project: 'go-play', limit: 1 })[0];
    const otherPrompt = db.search({ project: 'web', limit: 1 })[0];
    const projectVector = new Float32Array(768);
    projectVector[1] = 1;
    const otherVector = new Float32Array(768);
    otherVector[0] = 1;
    const query = new Float32Array(768);
    query[0] = 1;
    db.saveEmbedding(projectPrompt.id, projectVector);
    db.saveEmbedding(otherPrompt.id, otherVector);

    const results = db.searchSemantic(query, 1, 'go-play');

    expect(results.map(result => result.id)).toEqual([projectPrompt.id]);
  });
});

describe('PhDB sync dedup (SPEC-010 G1/G2/G3)', () => {
  let dir: string;
  let db: PhDB;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-sync-'));
    db = new PhDB(path.join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('getPromptBySyncHash finds an entry by its sync_hash metadata (G2)', () => {
    const hash = 'abc123';
    db.insert({
      timestamp: '2026-08-08T10:00:00.000Z', tool: 'claude', prompt: 'a stable prompt', response: 'resp',
      args: '', workdir: '/x', hostname: 'h', exit_code: 0,
      metadata: JSON.stringify({ sync_hash: hash }),
    });
    expect(db.getPromptBySyncHash(hash)).toBeDefined();
    expect(db.getPromptBySyncHash('missing')).toBeUndefined();
  });

  it('getPromptCountSince counts only newer prompts (G3)', () => {
    db.insert({ timestamp: '2026-08-08T10:00:00.000Z', tool: 'a', prompt: 'first prompt text', metadata: '{}', args: '', workdir: '/', hostname: 'h', exit_code: 0 });
    db.insert({ timestamp: '2026-08-08T12:00:00.000Z', tool: 'a', prompt: 'second prompt text', metadata: '{}', args: '', workdir: '/', hostname: 'h', exit_code: 0 });
    expect(db.getPromptCountSince('2026-08-08T11:00:00.000Z')).toBe(1);
    expect(db.getPromptCountSince('1970-01-01T00:00:00.000Z')).toBe(2);
  });
});

describe('PhDB archive (SPEC-009)', () => {
  let dir: string;
  let db: PhDB;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-archive-'));
    db = new PhDB(path.join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const insertOne = (prompt: string, ts = '2026-08-08T10:00:00.000Z') => db.insert({
    timestamp: ts, tool: 'claude', prompt, response: 'r', args: '', workdir: '/p',
    hostname: 'h', exit_code: 0, metadata: '{}',
  });

  it('archivePrompts moves a row out of prompts into prompts_archive (G2)', () => {
    const id = insertOne('some archived prompt about testing');
    const moved = db.archivePrompts([id]);
    expect(moved).toBe(1);
    expect(db.getById(id)).toBeUndefined();
    const stats = db.getArchiveStats();
    expect(stats.total).toBe(1);
    const archived = db.searchArchive({});
    expect(archived).toHaveLength(1);
    expect(archived[0].original_id).toBe(id);
  });

  it('archive of unknown id is a no-op', () => {
    expect(db.archivePrompts([999])).toBe(0);
  });

  it('purgeArchive deletes archived entries older than the cutoff (G3)', () => {
    const id = insertOne('another prompt to archive later');
    db.archivePrompts([id]);
    // cutoff in the future → today's archived row is older
    const purged = db.purgeArchive(new Date(Date.now() + 86_400_000).toISOString());
    expect(purged).toBe(1);
    expect(db.getArchiveStats().total).toBe(0);
  });

  it('getArchiveStats reflects newest/oldest (G5)', () => {
    insertOne('first archived candidate');
    insertOne('second archived candidate');
    const ids = db.getAllPrompts().map(p => p.id);
    db.archivePrompts(ids);
    const stats = db.getArchiveStats();
    expect(stats.total).toBe(2);
    expect(stats.oldest).toBe('2026-08-08T10:00:00.000Z');
  });
});

describe('PhDB memories & summaries (SPEC-007)', () => {
  let dir: string;
  let db: PhDB;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-mem-'));
    db = new PhDB(path.join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('upsertProjectMemory is append-only (G1)', () => {
    const base = { project: 'proj-x', prompt_id: 1, summary: 's', key_insights: ['i1'], technical_decisions: ['d1'] };
    db.upsertProjectMemory(base);
    db.upsertProjectMemory({ ...base, prompt_id: 2, summary: 's2', key_insights: ['i2'], technical_decisions: [] });
    expect(db.searchMemories('proj-x', 10)).toHaveLength(2);
  });

  it('upsertProjectSummary merges and dedups to a single row (G2/G3)', () => {
    db.upsertProjectSummary({ project: 'proj-x', summary: 'first', key_insights: ['same-insight'], technical_decisions: ['dec-a'] });
    db.upsertProjectSummary({ project: 'proj-x', summary: 'second', key_insights: ['same-insight', 'new-insight'], technical_decisions: ['dec-a', 'dec-b'] });
    const s = db.getProjectSummary('proj-x');
    expect(s).not.toBeNull();
    expect(s?.key_insights).toEqual(expect.arrayContaining(['same-insight', 'new-insight']));
    expect(s?.key_insights).toHaveLength(2);
    expect(s?.technical_decisions).toHaveLength(2);
    expect(s?.prompt_count).toBe(2);
    expect(db.getAllProjectsWithSummaries()).toContain('proj-x');
  });

  it('recordMemoryAccess increments access_count (G4)', () => {
    db.upsertProjectMemory({ project: 'p', prompt_id: 1, summary: 's', key_insights: [], technical_decisions: [] });
    const mem = db.getLastMemoryForProject('p');
    expect(mem).toBeDefined();
    db.recordMemoryAccess(mem!.id);
    const after = db.getMemoryById(mem!.id);
    expect(after?.access_count).toBe(1);
    expect(after?.last_accessed).toBeDefined();
  });

  it('getProjectSummary returns null for unknown project', () => {
    expect(db.getProjectSummary('nope')).toBeNull();
  });
});
