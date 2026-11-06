import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
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

  it('keeps a stable database identity per file and assigns different identities to separate files', () => {
    const otherPath = path.join(dir, 'other.db');
    const other = new PhDB(otherPath);
    const firstId = db.databaseId;
    const otherId = other.databaseId;
    other.close();

    const reopened = new PhDB(path.join(dir, 'test.db'));
    try {
      expect(reopened.databaseId).toBe(firstId);
      expect(otherId).not.toBe(firstId);
    } finally {
      reopened.close();
    }
  });

  it('backfills legacy analysis metadata once without rescanning blank rows on later opens', () => {
    const legacyPath = path.join(dir, 'legacy.db');
    const legacy = new Database(legacyPath);
    legacy.exec(`CREATE TABLE prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      tool TEXT NOT NULL,
      prompt TEXT NOT NULL,
      args TEXT NOT NULL DEFAULT '',
      workdir TEXT NOT NULL DEFAULT '',
      hostname TEXT NOT NULL DEFAULT '',
      exit_code INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}'
    )`);
    const insertLegacy = legacy.prepare(
      'INSERT INTO prompts (timestamp, tool, prompt, metadata) VALUES (?, ?, ?, ?)'
    );
    const analyzedId = Number(insertLegacy.run(
      '2026-08-08T10:00:00.000Z', 'codex', 'legacy prompt',
      JSON.stringify({ summary: 'legacy cedar finding', key_insights: ['legacy birch insight'] }),
    ).lastInsertRowid);
    const blankId = Number(insertLegacy.run(
      '2026-08-08T11:00:00.000Z', 'codex', 'unanalysed legacy prompt', '{}',
    ).lastInsertRowid);
    legacy.close();

    const migrated = new PhDB(legacyPath);
    try {
      expect(migrated.search({ query: 'cedar', limit: 5 }).map(row => row.id)).toContain(analyzedId);
      expect(migrated.search({ query: 'birch', limit: 5 }).map(row => row.id)).toContain(analyzedId);
      expect(migrated['db'].prepare('SELECT search_metadata FROM prompts WHERE id = ?').get(blankId))
        .toEqual({ search_metadata: '' });
      expect(migrated['db'].prepare("SELECT value FROM ph_meta WHERE key = 'search_metadata_backfill_v1'").get())
        .toEqual({ value: 'complete' });
    } finally {
      migrated.close();
    }

    const prepare = vi.spyOn(Database.prototype, 'prepare');
    const reopened = new PhDB(legacyPath);
    try {
      const backfillWasQueried = prepare.mock.calls.some(([sql]) => String(sql).includes("WHERE search_metadata = ''"));
      expect(backfillWasQueried).toBe(false);
    } finally {
      reopened.close();
      prepare.mockRestore();
    }
  });

  it('migrates legacy memories without discarding personal provenance, versions, or summaries (v4)', () => {
    const legacyPath = path.join(dir, 'legacy-v2.db');
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE ph_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO ph_meta VALUES ('schema_version', '2');
      CREATE TABLE memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        prompt_id INTEGER,
        summary TEXT NOT NULL,
        key_insights TEXT NOT NULL,
        technical_decisions TEXT NOT NULL,
        created_at TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed TEXT
      );
      INSERT INTO memories (project, prompt_id, summary, key_insights, technical_decisions, created_at)
      VALUES ('legacy-proj', 10, 'Legacy summary', '["insight 1"]', '["decision 1"]', '2026-08-08T10:00:00.000Z');

      CREATE TABLE personal_memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        scope TEXT NOT NULL,
        kind TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        source TEXT NOT NULL,
        source_ref TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        forgotten_at TEXT
      );
      INSERT INTO personal_memories (id, content, scope, kind, sensitivity, source, source_ref, status, created_at, updated_at)
      VALUES ('pm-1', 'Always use vitest', 'work', 'preference', 'normal', 'ph-auto-capture', 'prompt:10:1', 'active', '2026-08-08T10:00:00.000Z', '2026-08-08T10:00:00.000Z');
      CREATE TABLE personal_memory_versions (
        memory_id TEXT NOT NULL, content TEXT NOT NULL, scope TEXT NOT NULL, kind TEXT NOT NULL,
        sensitivity TEXT NOT NULL, source TEXT NOT NULL, source_ref TEXT, status TEXT NOT NULL,
        changed_at TEXT NOT NULL
      );
      INSERT INTO personal_memory_versions VALUES
        ('pm-1', 'Earlier preference', 'work', 'preference', 'normal', 'manual', 'prompt:9:1', 'active', '2026-08-08T09:00:00.000Z');
      CREATE TABLE project_summaries (
        project TEXT PRIMARY KEY, summary TEXT NOT NULL, key_insights TEXT NOT NULL,
        technical_decisions TEXT NOT NULL, prompt_count INTEGER NOT NULL,
        first_analyzed TEXT NOT NULL, last_analyzed TEXT NOT NULL, git_context_snapshot TEXT NOT NULL
      );
      INSERT INTO project_summaries VALUES
        ('legacy-proj', 'Curated summary', '["curated insight"]', '["curated decision"]', 7,
         '2026-01-01', '2026-08-01', '{"branch":"main"}');
    `);
    legacy.close();

    const migrated = new PhDB(legacyPath);
    try {
      const all = migrated.getAllMemories();
      expect(all.length).toBeGreaterThanOrEqual(2);
      const projMem = all.find(m => m.project === 'legacy-proj');
      expect(projMem).toBeDefined();
      expect(projMem?.content).toContain('Legacy summary');
      expect(projMem?.scope).toBe('project');

      const personalMem = all.find(m => m.content === 'Always use vitest');
      expect(personalMem).toBeDefined();
      expect(personalMem?.scope).toBe('work');
      expect(personalMem?.kind).toBe('preference');
      expect(personalMem?.source).toBe('ph-auto-capture');
      expect(personalMem?.source_ref).toBe('prompt:10:1');
      expect(personalMem?.external_id).toBe('pm-1');
      expect(migrated['db'].prepare('SELECT count(*) AS c FROM memory_versions').get()).toEqual({ c: 1 });
      expect(migrated['db'].prepare('SELECT count(*) AS c FROM project_summaries').get()).toEqual({ c: 1 });

      // Verify FTS search works on migrated memories
      const searchRes = migrated.searchMemories({ query: 'vitest', includePersonal: true });
      expect(searchRes).toHaveLength(1);
      expect(searchRes[0].content).toBe('Always use vitest');
    } finally {
      migrated.close();
    }
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

  it('loads only the selected project embeddings without parsing every prompt individually', () => {
    const first = db.insert({
      timestamp: '2026-08-08T10:00:00.000Z', tool: 'claude', prompt: 'first project prompt', response: '',
      args: '', workdir: '/a', hostname: 'h', exit_code: 0, metadata: JSON.stringify({ project: 'go-play' }),
    });
    const second = db.insert({
      timestamp: '2026-08-08T11:00:00.000Z', tool: 'claude', prompt: 'other project prompt', response: '',
      args: '', workdir: '/b', hostname: 'h', exit_code: 0, metadata: JSON.stringify({ project: 'web' }),
    });
    db.saveEmbedding(first, new Float32Array(768));
    db.saveEmbedding(second, new Float32Array(768));
    db['db'].prepare("UPDATE prompts SET metadata = '{broken json' WHERE id = ?").run(second);

    expect([...db.getEmbeddingsForProject('go-play').keys()]).toEqual([first]);
    expect([...db.getEmbeddingsForProject('missing').keys()]).toEqual([]);
  });

  it('searches and refreshes analyzed summary, insight, and decision text', () => {
    const id = db.insert({
      timestamp: '2026-08-08T12:00:00.000Z', tool: 'claude', prompt: 'A neutral interaction', response: 'A neutral answer',
      args: '', workdir: '/a', hostname: 'h', exit_code: 0,
      metadata: JSON.stringify({ project: 'ph', summary: 'cedar migration', key_insights: ['birch lock'], technical_decisions: ['maple index'] }),
    });

    expect(db.search({ query: 'cedar', limit: 10 }).map(row => row.id)).toContain(id);
    expect(db.search({ query: 'birch', limit: 10 }).map(row => row.id)).toContain(id);
    expect(db.search({ query: 'maple', limit: 10 }).map(row => row.id)).toContain(id);

    db.updateMetadataFields(id, { summary: 'spruce migration' });
    expect(db.search({ query: 'cedar', limit: 10 }).map(row => row.id)).not.toContain(id);
    expect(db.search({ query: 'spruce', limit: 10 }).map(row => row.id)).toContain(id);
  });

  it('rebuilds the analysis search index from an existing response-aware database', () => {
    const legacyPath = path.join(dir, 'legacy.db');
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, tool TEXT NOT NULL,
        prompt TEXT NOT NULL, response TEXT NOT NULL DEFAULT '', args TEXT NOT NULL DEFAULT '',
        workdir TEXT NOT NULL DEFAULT '', hostname TEXT NOT NULL DEFAULT '', exit_code INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      INSERT INTO prompts(timestamp, tool, prompt, response, metadata)
      VALUES ('2026-08-08T10:00:00.000Z', 'codex', 'plain question', 'plain answer',
        '{"summary":"legacy cedar finding","key_insights":["legacy birch insight"]}');
      CREATE VIRTUAL TABLE prompts_fts USING fts5(prompt, response, tool UNINDEXED, content='prompts', content_rowid='id');
      INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild');
    `);
    legacy.close();

    const migrated = new PhDB(legacyPath);
    try {
      expect(migrated.search({ query: 'cedar', limit: 10 })).toHaveLength(1);
      expect(migrated.search({ query: 'birch', limit: 10 })).toHaveLength(1);
    } finally {
      migrated.close();
    }
  });

  it('orders text matches by relevance before recency', () => {
    db.insert({ timestamp: '2026-08-08T12:00:00.000Z', tool: 'claude', prompt: 'goroutines with channels plus unrelated implementation detail, migration, deployment, and performance notes', response: '', args: '', workdir: '/a', hostname: 'h', exit_code: 0, metadata: '{}' });
    const results = db.search({ query: 'goroutines with channels', limit: 10 });
    expect(results[0].prompt).toContain('goroutines with channels');
    expect(results[0].prompt).toBe('explain goroutines with channels');
  });

  it('fuses raw and analysis rankings so repeated cross-source evidence rises', () => {
    const both = db.insert({
      timestamp: '2026-08-08T08:00:00.000Z', tool: 'codex',
      prompt: 'quartz cache migration', response: 'quartz cache stays local',
      args: '', workdir: '/a', hostname: 'h', exit_code: 0,
      metadata: JSON.stringify({ summary: 'quartz cache decision', key_insights: ['quartz'] }),
    });
    db.insert({
      timestamp: '2026-08-08T12:00:00.000Z', tool: 'codex',
      prompt: 'quartz', response: '', args: '', workdir: '/a', hostname: 'h', exit_code: 0,
      metadata: '{}',
    });
    const results = db.search({ query: 'quartz', limit: 10 });
    expect(results.map(row => row.id).indexOf(both)).toBeLessThan(1);
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

describe('PhDB memories (SPEC-007 unified schema v3)', () => {
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

  it('addMemory inserts a project memory and searches by text and project', () => {
    const mem = db.addMemory({
      content: 'Always use ESM imports with .js extension in TypeScript',
      scope: 'project',
      project: 'ph',
      kind: 'fact',
    });

    expect(mem.id).toBeDefined();
    expect(mem.scope).toBe('project');
    expect(mem.project).toBe('ph');
    expect(mem.status).toBe('active');

    const byProj = db.searchMemories({ project: 'ph' });
    expect(byProj).toHaveLength(1);
    expect(byProj[0].id).toBe(mem.id);

    const byFts = db.searchMemories({ query: 'extension' });
    expect(byFts).toHaveLength(1);
    expect(byFts[0].id).toBe(mem.id);

    const otherProj = db.searchMemories({ project: 'other' });
    expect(otherProj).toHaveLength(0);
  });

  it('rejects a project memory sourced from a different project interaction', () => {
    const sourceId = db.insert({
      timestamp: '2026-08-08T10:00:00.000Z', tool: 'codex', prompt: 'decision', response: '',
      args: '', workdir: '/tmp/other', hostname: 'test', exit_code: 0,
      metadata: JSON.stringify({ project: 'other' }),
    });
    expect(() => db.addMemory({ content: 'A sourced decision for ph', scope: 'project', project: 'ph', prompt_ids: [sourceId] }))
      .toThrow('belongs to project "other", not "ph"');
    expect(db.searchMemories({ project: 'ph' })).toHaveLength(0);
  });

  it('accepts a project memory sourced from an interaction in the same project', () => {
    const sourceId = db.insert({
      timestamp: '2026-08-08T10:00:00.000Z', tool: 'codex', prompt: 'decision', response: '',
      args: '', workdir: '/tmp/ph', hostname: 'test', exit_code: 0,
      metadata: JSON.stringify({ project: 'ph' }),
    });
    const saved = db.addMemory({ content: 'A sourced decision for ph', scope: 'project', project: 'ph', prompt_ids: [sourceId] });
    expect(saved.prompt_ids).toEqual([sourceId]);
  });

  it('forgets and restores a memory', () => {
    const mem = db.addMemory({
      content: 'Temporary experimental flag',
      scope: 'project',
      project: 'ph',
      kind: 'fact',
    });

    expect(db.searchMemories({ query: 'experimental' })).toHaveLength(1);

    const forgotten = db.forgetMemory(mem.id);
    expect(forgotten).toBe(true);

    // Active searches ignore archived
    expect(db.searchMemories({ query: 'experimental' })).toHaveLength(0);
    // Explicit archived status retrieves it
    expect(db.searchMemories({ query: 'experimental', includeForgotten: true })).toHaveLength(1);

    const restored = db.restoreMemory(mem.id);
    expect(restored).toBe(true);
    expect(db.searchMemories({ query: 'experimental' })).toHaveLength(1);
  });

  it('permanently deletes a memory', () => {
    const mem = db.addMemory({
      content: 'Sensitive token to remove',
      scope: 'project',
      project: 'ph',
      kind: 'fact',
    });

    expect(db.getMemoryById(mem.id)).toBeDefined();
    db.deleteMemory(mem.id);
    expect(db.getMemoryById(mem.id)).toBeUndefined();
    expect(db.searchMemories({ query: 'token' })).toHaveLength(0);
  });
});
