import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import type { PromptEntry, SearchOptions } from '../types.js';

export function defaultPath(): string {
  return path.join(os.homedir(), '.prompt_history.db');
}

export class PhDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
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

    // Migration: metadata column (for legacy Go-created DBs)
    try {
      this.db.exec("ALTER TABLE prompts ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'");
    } catch { /* already exists */ }

    // Migration: response column
    try {
      this.db.exec("ALTER TABLE prompts ADD COLUMN response TEXT NOT NULL DEFAULT ''");
    } catch { /* already exists */ }

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
    this.db
      .prepare('INSERT OR REPLACE INTO embeddings (prompt_id, vector) VALUES (?, ?)')
      .run(id, buf);
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
         LEFT JOIN embeddings e ON e.prompt_id = p.id
         WHERE e.prompt_id IS NULL`
      )
      .all() as PromptEntry[];
  }

  deleteById(id: number): void {
    this.db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
  }

  deleteByIds(ids: number[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const info = this.db.prepare(`DELETE FROM prompts WHERE id IN (${placeholders})`).run(...ids);
    return info.changes;
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
