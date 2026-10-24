import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { createHash, randomUUID } from 'crypto';
import * as sqliteVec from 'sqlite-vec';
import type { PromptEntry, SearchOptions, MemoryEntry, ProjectSummary, ArchivedPromptEntry } from '../types.js';
import { SemanticIndex } from './semantic-index.js';
import { MemoryRepository } from './memory-repository.js';
import { ArchiveRepository } from './archive-repository.js';

export function defaultPath(): string {
  return path.join(os.homedir(), '.prompt_history.db');
}

function analysisSearchText(raw: string): string {
  try {
    const metadata = JSON.parse(raw) as Record<string, unknown>;
    const values: unknown[] = [metadata['title'], metadata['role'], metadata['project'], metadata['language'], metadata['summary']];
    for (const key of ['tags', 'key_insights', 'technical_decisions']) {
      const value = metadata[key];
      if (Array.isArray(value)) values.push(...value);
    }
    return values.filter((value): value is string => typeof value === 'string').join(' ');
  } catch {
    return '';
  }
}

export class PhDB {
  private static readonly PROJECT_SUMMARIES_SCHEMA = `
    CREATE TABLE IF NOT EXISTS project_summaries (
      project     TEXT    PRIMARY KEY,
      summary     TEXT    NOT NULL DEFAULT '',
      key_insights TEXT   NOT NULL DEFAULT '[]',
      technical_decisions TEXT NOT NULL DEFAULT '[]',
      prompt_count INTEGER NOT NULL DEFAULT 0,
      first_analyzed TEXT  NOT NULL,
      last_analyzed TEXT   NOT NULL,
      git_context_snapshot TEXT
    );
  `;

  private static readonly ARCHIVE_SCHEMA = `
    CREATE TABLE IF NOT EXISTS prompts_archive (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT    NOT NULL,
      tool      TEXT    NOT NULL,
      prompt    TEXT    NOT NULL,
      response  TEXT    NOT NULL DEFAULT '',
      args      TEXT    NOT NULL DEFAULT '',
      workdir   TEXT    NOT NULL DEFAULT '',
      hostname  TEXT    NOT NULL DEFAULT '',
      exit_code INTEGER NOT NULL DEFAULT 0,
      metadata  TEXT    NOT NULL DEFAULT '{}',
      archived_at TEXT   NOT NULL,
      original_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_archive_timestamp ON prompts_archive(timestamp);
    CREATE INDEX IF NOT EXISTS idx_archive_original_id ON prompts_archive(original_id);
  `;

  private db: Database.Database;
  private semanticIndex: SemanticIndex;
  private memoryRepository: MemoryRepository;
  private archiveRepository: ArchiveRepository;

  /** Absolute path of the SQLite file (used by the HTTP server health endpoint). */
  readonly dbPath: string;
  /** Stable identity stored in the database; remote cursors are scoped to it. */
  readonly databaseId: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    sqliteVec.load(this.db);
    this.semanticIndex = new SemanticIndex(this.db);
    this.migrate();
    this.databaseId = (this.db.prepare("SELECT value FROM ph_meta WHERE key = 'database_id'").get() as { value: string }).value;
    this.memoryRepository = new MemoryRepository(this.db);
    this.archiveRepository = new ArchiveRepository(this.db);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ph_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

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

    const databaseId = this.db.prepare("SELECT value FROM ph_meta WHERE key = 'database_id'").get();
    if (!databaseId) this.db.prepare("INSERT OR IGNORE INTO ph_meta (key, value) VALUES ('database_id', ?)").run(randomUUID());

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

    this.db.exec(PhDB.PROJECT_SUMMARIES_SCHEMA);
    this.db.exec(PhDB.ARCHIVE_SCHEMA);

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

    // Derived searchable metadata keeps analysis text in the FTS index without
    // requiring a JSON scan for every query.
    try {
      this.db.exec("ALTER TABLE prompts ADD COLUMN search_metadata TEXT NOT NULL DEFAULT ''");
    } catch { /* already exists */ }
    const searchMetadataMigration = this.db.prepare(
      "SELECT value FROM ph_meta WHERE key = 'search_metadata_backfill_v1'",
    ).get();
    if (!searchMetadataMigration) {
      const backfillSearchMetadata = this.db.transaction(() => {
        const migration = this.db.prepare(
          "SELECT value FROM ph_meta WHERE key = 'search_metadata_backfill_v1'",
        ).get();
        if (migration) return;
        const metadataRows = this.db.prepare("SELECT id, metadata FROM prompts WHERE search_metadata = ''").all() as { id: number; metadata: string }[];
        const updateSearchMetadata = this.db.prepare('UPDATE prompts SET search_metadata = ? WHERE id = ?');
        for (const row of metadataRows) updateSearchMetadata.run(analysisSearchText(row.metadata), row.id);
        this.db.prepare("INSERT OR IGNORE INTO ph_meta (key, value) VALUES ('search_metadata_backfill_v1', 'complete')").run();
      });
      backfillSearchMetadata.immediate();
    }

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

    // Keep raw-text BM25 isolated from analyzed metadata so derived fields do not
    // change the ranking of existing prompt/response matches.
    const ftsRow = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='prompts_fts'")
      .get() as { sql: string } | undefined;

    if (!ftsRow?.sql?.includes('response') || ftsRow.sql.includes('search_metadata')) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec(`
          DROP TABLE IF EXISTS prompts_fts;
          DROP TRIGGER IF EXISTS prompts_ai;
          DROP TRIGGER IF EXISTS prompts_ad;
          DROP TRIGGER IF EXISTS prompts_au;

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

          CREATE TRIGGER prompts_au AFTER UPDATE OF prompt, response, tool ON prompts BEGIN
            INSERT INTO prompts_fts(prompts_fts, rowid, prompt, response, tool)
              VALUES('delete', old.id, old.prompt, old.response, old.tool);
            INSERT INTO prompts_fts(rowid, prompt, response, tool)
              VALUES (new.id, new.prompt, new.response, new.tool);
          END;

          INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild');
        `);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }

    const rawFtsUpdateTrigger = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name='prompts_au'"
    ).get();
    if (!rawFtsUpdateTrigger) {
      this.db.exec(`
        CREATE TRIGGER prompts_au AFTER UPDATE OF prompt, response, tool ON prompts BEGIN
          INSERT INTO prompts_fts(prompts_fts, rowid, prompt, response, tool)
            VALUES('delete', old.id, old.prompt, old.response, old.tool);
          INSERT INTO prompts_fts(rowid, prompt, response, tool)
            VALUES (new.id, new.prompt, new.response, new.tool);
        END;
      `);
    }

    // Analysis text has a separate FTS index so adding metadata does not perturb
    // the established BM25 scores of prompt and response matches.
    const analysisFtsRow = this.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='prompts_analysis_fts'"
    ).get() as { sql: string } | undefined;
    if (!analysisFtsRow?.sql?.includes('search_metadata')) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec(`
          DROP TABLE IF EXISTS prompts_analysis_fts;
          DROP TRIGGER IF EXISTS prompts_analysis_ai;
          DROP TRIGGER IF EXISTS prompts_analysis_ad;
          DROP TRIGGER IF EXISTS prompts_analysis_au;

          CREATE VIRTUAL TABLE prompts_analysis_fts USING fts5(
            search_metadata,
            content='prompts',
            content_rowid='id'
          );

          CREATE TRIGGER prompts_analysis_ai AFTER INSERT ON prompts BEGIN
            INSERT INTO prompts_analysis_fts(rowid, search_metadata) VALUES (new.id, new.search_metadata);
          END;

          CREATE TRIGGER prompts_analysis_ad AFTER DELETE ON prompts BEGIN
            INSERT INTO prompts_analysis_fts(prompts_analysis_fts, rowid, search_metadata)
              VALUES('delete', old.id, old.search_metadata);
          END;

          CREATE TRIGGER prompts_analysis_au AFTER UPDATE OF search_metadata ON prompts BEGIN
            INSERT INTO prompts_analysis_fts(prompts_analysis_fts, rowid, search_metadata)
              VALUES('delete', old.id, old.search_metadata);
            INSERT INTO prompts_analysis_fts(rowid, search_metadata) VALUES (new.id, new.search_metadata);
          END;

          INSERT INTO prompts_analysis_fts(prompts_analysis_fts) VALUES('rebuild');
        `);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
  }

  /** `response` is optional at the call site (runtime defaults to ''). */
  insert(entry: Omit<PromptEntry, 'id' | 'response'> & { response?: string }): number {
    const meta = entry.metadata || '{}';
    const response = entry.response ?? '';
    const info = this.db
      .prepare(
        `INSERT INTO prompts (timestamp, tool, prompt, response, args, workdir, hostname, exit_code, metadata, search_metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        meta,
        analysisSearchText(meta)
      );
    return info.lastInsertRowid as number;
  }

  updateExitCode(id: number, code: number): void {
    this.db.prepare('UPDATE prompts SET exit_code = ? WHERE id = ?').run(code, id);
  }

  updateMetadata(id: number, metadata: string): void {
    this.db.prepare('UPDATE prompts SET metadata = ?, search_metadata = ? WHERE id = ?').run(metadata, analysisSearchText(metadata), id);
  }

  updateMetadataFields(id: number, patch: Record<string, unknown>): void {
    const update = this.db.transaction(() => {
      const entry = this.getById(id);
      if (!entry) return;
      let metadata: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(entry.metadata);
        metadata = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      } catch {
        metadata = {};
      }
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === null) delete metadata[key];
        else metadata[key] = value;
      }
      this.updateMetadata(id, JSON.stringify(metadata));
    });
    update();
  }

  updateResponse(id: number, response: string): void {
    this.db.prepare('UPDATE prompts SET response = ? WHERE id = ?').run(response, id);
  }

  getById(id: number): PromptEntry | undefined {
    return this.db
      .prepare('SELECT * FROM prompts WHERE id = ?')
      .get(id) as PromptEntry | undefined;
  }

  getArchivedById(id: number): ArchivedPromptEntry | undefined {
    return this.archiveRepository.getByOriginalIdOrArchiveId(id);
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
        WITH raw_matches AS (
          SELECT f.rowid AS id, bm25(prompts_fts) AS score
          FROM prompts_fts f WHERE prompts_fts MATCH ?
        ), raw_ranked AS (
          SELECT m.id, ROW_NUMBER() OVER (ORDER BY m.score ASC, p.timestamp DESC, p.id DESC) AS position
          FROM raw_matches m JOIN prompts p ON p.id = m.id
        ), analysis_matches AS (
          SELECT f.rowid AS id, bm25(prompts_analysis_fts) AS score
          FROM prompts_analysis_fts f WHERE prompts_analysis_fts MATCH ?
        ), analysis_ranked AS (
          SELECT m.id, ROW_NUMBER() OVER (ORDER BY m.score ASC, p.timestamp DESC, p.id DESC) AS position
          FROM analysis_matches m JOIN prompts p ON p.id = m.id
        ), ranked_sources AS (
          SELECT id, position FROM raw_ranked
          UNION ALL
          SELECT id, position FROM analysis_ranked
        ), fused AS (
          SELECT id, SUM(1.0 / (60.0 + position)) AS score
          FROM ranked_sources GROUP BY id
        )
        SELECT p.*
        FROM fused r
        JOIN prompts p ON p.id = r.id
        WHERE 1=1${filterClause}
        ORDER BY r.score DESC, p.timestamp DESC, p.id DESC
        LIMIT ?
      `;
      return this.db.prepare(sql).all(sanitized, sanitized, ...ftsArgs, opts.limit) as PromptEntry[];
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
    this.semanticIndex.save(id, vector);
  }

  searchSemantic(queryVector: Float32Array, limit: number, project?: string): PromptEntry[] {
    return this.semanticIndex.search(queryVector, limit, project);
  }

  getAllEmbeddings(): Map<number, Float32Array> {
    return this.semanticIndex.loadAll();
  }

  getEmbeddingsForProject(project: string): Map<number, Float32Array> {
    return this.semanticIndex.loadProject(project);
  }

  getPromptsWithoutEmbeddings(): PromptEntry[] {
    return this.semanticIndex.findMissingPrompts();
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

  getPromptsAfterId(id: number, limit: number): PromptEntry[] {
    return this.db
      .prepare('SELECT * FROM prompts WHERE id > ? ORDER BY id ASC LIMIT ?')
      .all(id, limit) as PromptEntry[];
  }

  getPromptCountAfterId(id: number): number {
    return (this.db.prepare('SELECT count(*) as c FROM prompts WHERE id > ?').get(id) as { c: number }).c;
  }

  getPromptCount(): number {
    return (this.db.prepare('SELECT count(*) as c FROM prompts').get() as { c: number }).c;
  }

  getPromptCountSince(timestamp: string): number {
    return (this.db.prepare('SELECT count(*) as c FROM prompts WHERE timestamp > ?').get(timestamp) as { c: number }).c;
  }

  getStats(): { total: number; totalMemories: number; byTool: Array<{ tool: string; count: number }> } {
    const total = (this.db.prepare('SELECT count(*) as c FROM prompts').get() as { c: number }).c;
    const totalMemories = (this.db.prepare('SELECT count(*) as c FROM memories').get() as { c: number }).c;
    const byTool = this.db
      .prepare('SELECT tool, count(*) as count FROM prompts GROUP BY tool ORDER BY count DESC')
      .all() as Array<{ tool: string; count: number }>;
    return { total, totalMemories, byTool };
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

  archivePrompts(ids: number[]): number { return this.archiveRepository.archivePrompts(ids); }
  searchArchive(opts: { since?: string; until?: string; limit?: number }): Array<Record<string, unknown>> { return this.archiveRepository.searchArchive(opts); }
  purgeArchive(beforeDate: string): number { return this.archiveRepository.purgeArchive(beforeDate); }
  getArchiveStats(): { total: number; oldest: string | null; newest: string | null } { return this.archiveRepository.getArchiveStats(); }

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

  // ─── Memory repository facade ─────────────────────────────────────────────

  insertMemory(mem: Omit<MemoryEntry, 'id'>): number { return this.memoryRepository.insertMemory(mem); }
  promoteMemories(memories: Omit<MemoryEntry, 'id'>[]): number[] { return this.memoryRepository.promoteMemories(memories); }
  updateMemory(id: number, updates: Partial<Omit<MemoryEntry, 'id' | 'project' | 'created_at'>>): void { this.memoryRepository.updateMemory(id, updates); }
  getMemoryById(id: number): MemoryEntry | undefined { return this.memoryRepository.getMemoryById(id); }
  searchMemories(project: string, limit = 10): MemoryEntry[] { return this.memoryRepository.searchMemories(project, limit); }
  upsertProjectMemory(entry: { project: string; prompt_id: number; summary: string; key_insights: string[]; technical_decisions: string[]; git_context_snapshot?: string }): number { return this.memoryRepository.upsertProjectMemory(entry); }
  getLastMemoryForProject(project: string): MemoryEntry | undefined { return this.memoryRepository.getLastMemoryForProject(project); }
  getAllProjectsWithMemories(): string[] { return this.memoryRepository.getAllProjectsWithMemories(); }
  upsertProjectSummary(params: { project: string; summary: string; key_insights: string[]; technical_decisions: string[]; git_context_snapshot?: string }): void { this.memoryRepository.upsertProjectSummary(params); }
  getProjectSummary(project: string): ProjectSummary | null { return this.memoryRepository.getProjectSummary(project); }
  getAllProjectsWithSummaries(): string[] { return this.memoryRepository.getAllProjectsWithSummaries(); }
  recordMemoryAccess(id: number): void { this.memoryRepository.recordMemoryAccess(id); }
  deleteMemory(id: number): void { this.memoryRepository.deleteMemory(id); }
  getAllMemoriesByProject(project: string): MemoryEntry[] { return this.memoryRepository.getAllMemoriesByProject(project); }

  getAllPromptsByProject(project: string): PromptEntry[] {
    return this.db
      .prepare(`SELECT * FROM prompts WHERE json_extract(metadata, '$.project') = ? ORDER BY timestamp ASC`)
      .all(project) as PromptEntry[];
  }

  getPromptsByProjectPaginated(project: string, page: number, pageSize: number): { entries: PromptEntry[]; total: number } {
    const total = this.db.prepare("SELECT COUNT(*) as count FROM prompts WHERE json_extract(metadata, '$.project') = ?").get(project) as { count: number };
    const entries = this.db
      .prepare(`SELECT * FROM prompts WHERE json_extract(metadata, '$.project') = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
      .all(project, pageSize, (page - 1) * pageSize) as PromptEntry[];
    return { entries, total: total.count };
  }

  getPromptCountByProject(project: string): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM prompts WHERE json_extract(metadata, '$.project') = ?").get(project) as { count: number };
    return row.count;
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
