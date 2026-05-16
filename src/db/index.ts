import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import * as sqliteVec from 'sqlite-vec';
import type { PromptEntry, SearchOptions, MemoryEntry } from '../types.js';

export function defaultPath(): string {
  return path.join(os.homedir(), '.prompt_history.db');
}

export class PhDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    sqliteVec.load(this.db);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prompts (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT    NOT NULL,
        tool      TEXT    NOT NULL,
        prompt    TEXT    NOT NULL,
        args      TEXT    NOT NULL DEFAULT '',
        workdir   TEXT    NOT NULL DEFAULT '',
        hostname  TEXT    NOT NULL DEFAULT '',
        exit_code INTEGER NOT NULL DEFAULT 0,
        metadata  TEXT    NOT NULL DEFAULT '{}'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
        prompt,
        tool UNINDEXED,
        content='prompts',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS prompts_ai AFTER INSERT ON prompts BEGIN
        INSERT INTO prompts_fts(rowid, prompt, tool) VALUES (new.id, new.prompt, new.tool);
      END;

      CREATE TRIGGER IF NOT EXISTS prompts_ad AFTER DELETE ON prompts BEGIN
        INSERT INTO prompts_fts(prompts_fts, rowid, prompt, tool)
          VALUES('delete', old.id, old.prompt, old.tool);
      END;

      CREATE INDEX IF NOT EXISTS idx_prompts_tool      ON prompts(tool);
      CREATE INDEX IF NOT EXISTS idx_prompts_timestamp ON prompts(timestamp);

      CREATE TABLE IF NOT EXISTS embeddings (
        prompt_id INTEGER PRIMARY KEY,
        vector    BLOB    NOT NULL,
        FOREIGN KEY(prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
      );
    `);

    // New native vector table (sqlite-vec)
    const vecTable = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_embeddings'").get() as { sql: string } | undefined;
    if (vecTable && !vecTable.sql.includes('vec0')) {
      this.db.exec("DROP TABLE vec_embeddings");
    }

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
        embedding float[768]
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        project     TEXT    NOT NULL,
        prompt_ids  TEXT    NOT NULL DEFAULT '[]',
        summary     TEXT    NOT NULL,
        key_insights    TEXT NOT NULL DEFAULT '[]',
        technical_decisions TEXT NOT NULL DEFAULT '[]',
        git_context_snapshot TEXT,
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL,
        access_count INTEGER DEFAULT 0,
        last_accessed TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
    `);

    // Migration: $schema_version in existing metadata
    const rowsWithoutSchema = this.db
      .prepare("SELECT id, metadata FROM prompts WHERE json_extract(metadata, '$.\\$schema_version') IS NULL")
      .all() as { id: number; metadata: string }[];
    for (const row of rowsWithoutSchema) {
      try {
        const meta = JSON.parse(row.metadata);
        meta.$schema_version = 1;
        this.db.prepare('UPDATE prompts SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), row.id);
      } catch { /* skip malformed metadata */ }
    }

    // Migration: metadata column (for legacy Go-created DBs)
    try {
      this.db.exec("ALTER TABLE prompts ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'");
    } catch { /* already exists */ }

    // Migration: response column
    try {
      this.db.exec("ALTER TABLE prompts ADD COLUMN response TEXT NOT NULL DEFAULT ''");
    } catch { /* already exists */ }

    // Migration: migrate data from old embeddings to new vec_embeddings if needed
    const oldEmbeds = this.db.prepare('SELECT count(*) as count FROM embeddings').get() as { count: number };
    const newEmbeds = this.db.prepare('SELECT count(*) as count FROM vec_embeddings').get() as { count: number };

    if (oldEmbeds.count > 0 && newEmbeds.count === 0) {
      const rows = this.db.prepare('SELECT prompt_id, vector FROM embeddings').all() as { prompt_id: number; vector: Buffer }[];
      const insert = this.db.prepare('INSERT INTO vec_embeddings(rowid, embedding) VALUES (?, vec_f32(?))');
      for (const row of rows) {
        try {
          insert.run(BigInt(row.prompt_id), row.vector);
        } catch (e: unknown) {
          console.error(`DEBUG Migration error for prompt #${row.prompt_id}: ${(e as Error).message}`);
        }
      }
    }

    // Migration: rebuild FTS5 to include response if not already indexed
    const ftsRow = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='prompts_fts'")
      .get() as { sql: string } | undefined;

    if (!ftsRow?.sql?.includes('response')) {
      this.db.exec(`
        DROP TABLE IF EXISTS prompts_fts;
        DROP TRIGGER IF EXISTS prompts_ai;
        DROP TRIGGER IF EXISTS prompts_ad;

        CREATE VIRTUAL TABLE prompts_fts USING fts5(
          prompt,
          response,
          tool UNINDEXED,
          content='prompts',
          content_rowid='id'
        );

        CREATE TRIGGER prompts_ai AFTER INSERT ON prompts BEGIN
          INSERT INTO prompts_fts(rowid, prompt, response, tool)
            VALUES (new.id, new.prompt, new.response, new.tool);
        END;

        CREATE TRIGGER prompts_ad AFTER DELETE ON prompts BEGIN
          INSERT INTO prompts_fts(prompts_fts, rowid, prompt, response, tool)
            VALUES('delete', old.id, old.prompt, old.response, old.tool);
        END;

        INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild');
      `);
    }
  }

  insert(entry: Omit<PromptEntry, 'id'>): number {
    const meta = entry.metadata || '{}';
    const response = entry.response ?? '';
    const info = this.db
      .prepare(
        `INSERT INTO prompts (timestamp, tool, prompt, response, args, workdir, hostname, exit_code, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.timestamp,
        entry.tool,
        entry.prompt,
        response,
        entry.args,
        entry.workdir,
        entry.hostname,
        entry.exit_code,
        meta
      );
    return info.lastInsertRowid as number;
  }

  updateExitCode(id: number, code: number): void {
    this.db.prepare('UPDATE prompts SET exit_code = ? WHERE id = ?').run(code, id);
  }

  updateMetadata(id: number, metadata: string): void {
    this.db.prepare('UPDATE prompts SET metadata = ? WHERE id = ?').run(metadata, id);
  }

  updateResponse(id: number, response: string): void {
    this.db.prepare('UPDATE prompts SET response = ? WHERE id = ?').run(response, id);
  }

  getById(id: number): PromptEntry | undefined {
    return this.db
      .prepare('SELECT * FROM prompts WHERE id = ?')
      .get(id) as PromptEntry | undefined;
  }

  search(opts: SearchOptions): PromptEntry[] {
    const ftsArgs: unknown[] = [];
    const ftsFilters: string[] = [];
    const scanArgs: unknown[] = [];
    const scanFilters: string[] = [];

    // Build filters for both paths.
    // FTS path uses a JOIN with alias 'p', so columns need the 'p.' prefix.
    // Scan path queries 'prompts' directly, no alias needed.
    if (opts.tool) {
      ftsFilters.push('p.tool = ?');
      ftsArgs.push(opts.tool);
      scanFilters.push('tool = ?');
      scanArgs.push(opts.tool);
    }
    if (opts.project) {
      ftsFilters.push("json_extract(p.metadata, '$.project') = ?");
      ftsArgs.push(opts.project);
      scanFilters.push("json_extract(metadata, '$.project') = ?");
      scanArgs.push(opts.project);
    }
    if (opts.language) {
      ftsFilters.push("json_extract(p.metadata, '$.language') = ?");
      ftsArgs.push(opts.language);
      scanFilters.push("json_extract(metadata, '$.language') = ?");
      scanArgs.push(opts.language);
    }
    if (opts.role) {
      ftsFilters.push("json_extract(p.metadata, '$.role') = ?");
      ftsArgs.push(opts.role);
      scanFilters.push("json_extract(metadata, '$.role') = ?");
      scanArgs.push(opts.role);
    }
    if (opts.tag) {
      // JSON array contains check: look for the tag value in the tags array
      ftsFilters.push("json_extract(p.metadata, '$.tags') LIKE ?");
      ftsArgs.push(`%"${opts.tag}"%`);
      scanFilters.push("json_extract(metadata, '$.tags') LIKE ?");
      scanArgs.push(`%"${opts.tag}"%`);
    }
    if (opts.starred) {
      ftsFilters.push("json_extract(p.metadata, '$.starred') = 1");
      scanFilters.push("json_extract(metadata, '$.starred') = 1");
    }
    if (opts.minQuality !== undefined) {
      ftsFilters.push("json_extract(p.metadata, '$.quality') >= ?");
      ftsArgs.push(opts.minQuality);
      scanFilters.push("json_extract(metadata, '$.quality') >= ?");
      scanArgs.push(opts.minQuality);
    }
    if (opts.minRelevance !== undefined) {
      ftsFilters.push("json_extract(p.metadata, '$.relevance') >= ?");
      ftsArgs.push(opts.minRelevance);
      scanFilters.push("json_extract(metadata, '$.relevance') >= ?");
      scanArgs.push(opts.minRelevance);
    }
    if (opts.since) {
      ftsFilters.push('p.timestamp >= ?');
      ftsArgs.push(opts.since.toISOString());
      scanFilters.push('timestamp >= ?');
      scanArgs.push(opts.since.toISOString());
    }
    if (opts.until) {
      ftsFilters.push('p.timestamp <= ?');
      ftsArgs.push(opts.until.toISOString());
      scanFilters.push('timestamp <= ?');
      scanArgs.push(opts.until.toISOString());
    }

    if (opts.query) {
      const sanitized = `"${opts.query.replace(/"/g, '""')}"`;
      const filterClause = ftsFilters.length > 0 ? ' AND ' + ftsFilters.join(' AND ') : '';
      const sql = `
        SELECT p.*
        FROM prompts_fts f
        JOIN prompts p ON p.id = f.rowid
        WHERE prompts_fts MATCH ?${filterClause}
        ORDER BY p.timestamp DESC
        LIMIT ?
      `;
      return this.db.prepare(sql).all(sanitized, ...ftsArgs, opts.limit) as PromptEntry[];
    } else {
      const filterClause = scanFilters.length > 0 ? ' AND ' + scanFilters.join(' AND ') : '';
      const sql = `
        SELECT * FROM prompts
        WHERE 1=1${filterClause}
        ORDER BY timestamp DESC
        LIMIT ?
      `;
      return this.db.prepare(sql).all(...scanArgs, opts.limit) as PromptEntry[];
    }
  }

  saveEmbedding(id: number, vector: Float32Array): void {
    const buf = Buffer.alloc(vector.length * 4);
    for (let i = 0; i < vector.length; i++) {
      buf.writeFloatLE(vector[i], i * 4);
    }
    // Save to both for safety during transition
    this.db
      .prepare('INSERT OR REPLACE INTO embeddings (prompt_id, vector) VALUES (?, ?)')
      .run(id, buf);
    this.db
      .prepare('INSERT OR REPLACE INTO vec_embeddings(rowid, embedding) VALUES (?, vec_f32(?))')
      .run(BigInt(id), buf);
  }

  searchSemantic(queryVector: Float32Array, limit: number): PromptEntry[] {
    const buf = Buffer.alloc(queryVector.length * 4);
    for (let i = 0; i < queryVector.length; i++) {
      buf.writeFloatLE(queryVector[i], i * 4);
    }

    const sql = `
      SELECT p.*, v.distance
      FROM vec_embeddings v
      JOIN prompts p ON p.id = v.rowid
      WHERE v.embedding MATCH vec_f32(?) AND k = ?
      ORDER BY v.distance ASC
    `;
    return this.db.prepare(sql).all(buf, limit) as PromptEntry[];
  }

  getAllEmbeddings(): Map<number, Float32Array> {
    const rows = this.db
      .prepare('SELECT prompt_id, vector FROM embeddings')
      .all() as { prompt_id: number; vector: Buffer }[];

    const map = new Map<number, Float32Array>();
    for (const row of rows) {
      const vec = new Float32Array(row.vector.length / 4);
      for (let i = 0; i < vec.length; i++) {
        vec[i] = row.vector.readFloatLE(i * 4);
      }
      map.set(row.prompt_id, vec);
    }
    return map;
  }

  getPromptsWithoutEmbeddings(): PromptEntry[] {
    return this.db
      .prepare(
        `SELECT p.* FROM prompts p
         LEFT JOIN vec_embeddings e ON e.rowid = p.id
         WHERE e.rowid IS NULL`
      )
      .all() as PromptEntry[];
  }

  getAllPrompts(limit: number = 1000000): PromptEntry[] {
    return this.db
      .prepare('SELECT * FROM prompts ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as PromptEntry[];
  }

  getPromptsSince(timestamp: string, limit: number = 10000): PromptEntry[] {
    return this.db
      .prepare('SELECT * FROM prompts WHERE timestamp > ? ORDER BY timestamp ASC LIMIT ?')
      .all(timestamp, limit) as PromptEntry[];
  }

  getPromptCount(): number {
    return (this.db.prepare('SELECT count(*) as c FROM prompts').get() as { c: number }).c;
  }

  getPromptBySyncHash(hash: string): PromptEntry | undefined {
    return this.db
      .prepare("SELECT * FROM prompts WHERE json_extract(metadata, '$.sync_hash') = ?")
      .get(hash) as PromptEntry | undefined;
  }

  getPromptsByRole(role: string): PromptEntry[] {
    return this.db
      .prepare("SELECT * FROM prompts WHERE json_extract(metadata, '$.role') = ? ORDER BY timestamp DESC")
      .all(role) as PromptEntry[];
  }

  getProjectMemory(projectName: string, limit: number = 10): PromptEntry[] {
    return this.db
      .prepare(`
        SELECT * FROM prompts 
        WHERE json_extract(metadata, '$.project') = ? 
        AND json_extract(metadata, '$.summary') IS NOT NULL
        ORDER BY timestamp DESC 
        LIMIT ?
      `)
      .all(projectName, limit) as PromptEntry[];
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
    // Cascadedelete for embeddings/vec_embeddings should be handled by FOREIGN KEY if supported, 
    // but better-sqlite3 needs pragma foreign_keys = ON.
    // However, vec0 doesn't support traditional foreign keys easily.
    this.db.prepare('DELETE FROM vec_embeddings WHERE rowid = ?').run(BigInt(id));
  }

  deleteById(id: number): void {
    this.delete(id);
  }

  deleteByIds(ids: number[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const info = this.db.prepare(`DELETE FROM prompts WHERE id IN (${placeholders})`).run(...ids);
    
    // For vec_embeddings we need to loop and cast to BigInt
    const delVec = this.db.prepare('DELETE FROM vec_embeddings WHERE rowid = ?');
    for (const id of ids) {
      delVec.run(BigInt(id));
    }
    return info.changes;
  }

  deleteOlderThan(days: number): number {
    // We need to find IDs first to clean up vec_embeddings
    const ids = this.db
      .prepare("SELECT id FROM prompts WHERE timestamp < datetime('now', ?)")
      .all(`-${days} days`) as { id: number }[];
    
    if (ids.length > 0) {
      return this.deleteByIds(ids.map(i => i.id));
    }
    return 0;
  }

  vacuum(): void {
    this.db.exec('VACUUM');
  }

  getAllPromptHashes(): Map<string, number> {
    const rows = this.db.prepare('SELECT id, prompt FROM prompts').all() as { id: number; prompt: string }[];
    const map = new Map<string, number>();
    for (const row of rows) {
      const hash = createHash('sha256').update(row.prompt.trim().toLowerCase()).digest('hex');
      map.set(hash, row.id);
    }
    return map;
  }

  // ─── Memory operations ──────────────────────────────────────────────────────

  insertMemory(mem: Omit<MemoryEntry, 'id'>): number {
    const info = this.db
      .prepare(`
        INSERT INTO memories (project, prompt_ids, summary, key_insights, technical_decisions,
                              git_context_snapshot, created_at, updated_at, access_count, last_accessed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        mem.project,
        JSON.stringify(mem.prompt_ids),
        mem.summary,
        JSON.stringify(mem.key_insights),
        JSON.stringify(mem.technical_decisions),
        mem.git_context_snapshot ?? null,
        mem.created_at,
        mem.updated_at,
        mem.access_count,
        mem.last_accessed ?? null,
      );
    return info.lastInsertRowid as number;
  }

  updateMemory(id: number, updates: Partial<Omit<MemoryEntry, 'id' | 'project' | 'created_at'>>): void {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (updates.prompt_ids !== undefined) {
      setClauses.push('prompt_ids = ?');
      params.push(JSON.stringify(updates.prompt_ids));
    }
    if (updates.summary !== undefined) {
      setClauses.push('summary = ?');
      params.push(updates.summary);
    }
    if (updates.key_insights !== undefined) {
      setClauses.push('key_insights = ?');
      params.push(JSON.stringify(updates.key_insights));
    }
    if (updates.technical_decisions !== undefined) {
      setClauses.push('technical_decisions = ?');
      params.push(JSON.stringify(updates.technical_decisions));
    }
    if (updates.git_context_snapshot !== undefined) {
      setClauses.push('git_context_snapshot = ?');
      params.push(updates.git_context_snapshot);
    }
    if (updates.access_count !== undefined) {
      setClauses.push('access_count = ?');
      params.push(updates.access_count);
    }
    if (updates.last_accessed !== undefined) {
      setClauses.push('last_accessed = ?');
      params.push(updates.last_accessed);
    }

    setClauses.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    this.db
      .prepare(`UPDATE memories SET ${setClauses.join(', ')} WHERE id = ?`)
      .run(...params);
  }

  getMemoryById(id: number): MemoryEntry | undefined {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.hydrateMemory(row);
  }

  searchMemories(project: string, limit: number = 10): MemoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM memories WHERE project = ? ORDER BY updated_at DESC LIMIT ?')
      .all(project, limit) as Record<string, unknown>[];
    return rows.map(r => this.hydrateMemory(r));
  }

  upsertProjectMemory(entry: { project: string; prompt_id: number; summary: string; key_insights: string[]; technical_decisions: string[]; git_context_snapshot?: string }): number {
    // Append-only: create a new memory entry each time, preserving full history
    return this.insertMemory({
      project: entry.project,
      prompt_ids: [entry.prompt_id],
      summary: entry.summary,
      key_insights: entry.key_insights,
      technical_decisions: entry.technical_decisions,
      git_context_snapshot: entry.git_context_snapshot,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      access_count: 0,
      last_accessed: undefined,
    });
  }

  getAllProjectsWithMemories(): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT project FROM memories ORDER BY project')
      .all() as { project: string }[];
    return rows.map(r => r.project);
  }

  recordMemoryAccess(id: number): void {
    this.db
      .prepare('UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  deleteMemory(id: number): void {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  private hydrateMemory(row: Record<string, unknown>): MemoryEntry {
    return {
      id: row.id as number,
      project: row.project as string,
      prompt_ids: JSON.parse(row.prompt_ids as string),
      summary: row.summary as string,
      key_insights: JSON.parse(row.key_insights as string),
      technical_decisions: JSON.parse(row.technical_decisions as string),
      git_context_snapshot: row.git_context_snapshot as string | undefined,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      access_count: row.access_count as number,
      last_accessed: row.last_accessed as string | undefined,
    };
  }

  getAllPromptsByProject(project: string): PromptEntry[] {
    return this.db
      .prepare(`
        SELECT * FROM prompts
        WHERE json_extract(metadata, '$.project') = ?
        ORDER BY timestamp ASC
      `)
      .all(project) as PromptEntry[];
  }

  getAllMemoriesByProject(project: string): MemoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM memories WHERE project = ? ORDER BY created_at ASC')
      .all(project) as Record<string, unknown>[];
    return rows.map(r => this.hydrateMemory(r));
  }

  close(): void {
    this.db.close();
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
