import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import type { PromptEntry, SearchOptions } from '../types.js';
import { SemanticIndex } from './semantic-index.js';
import { buildFtsTermsQuery, tokenize } from './fts.js';
import { syncHash } from '../utils/syncHash.js';
import { captureHash } from '../utils/captureHash.js';

export function extractProjectFromMetadata(raw?: string | null): string {
  if (!raw) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const project = (parsed as { project?: unknown }).project;
      return typeof project === 'string' ? project.trim() : '';
    }
  } catch {
    // ignore invalid metadata JSON
  }
  return '';
}

export function computeCaptureHashForRow(row: {
  tool: string;
  workdir?: string | null;
  metadata?: string | null;
  prompt: string;
  response?: string | null;
}): string {
  let meta: Record<string, unknown> = {};
  if (row.metadata) {
    try {
      const parsed: unknown = JSON.parse(row.metadata);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        meta = parsed as Record<string, unknown>;
      }
    } catch {
      meta = {};
    }
  }
  const rowWorkdir = typeof row.workdir === 'string' ? row.workdir.trim() : '';
  const metaWorkdir = typeof meta.workdir === 'string' ? meta.workdir.trim() : '';
  const metaProject = typeof meta.project === 'string' ? meta.project.trim() : '';
  const workdir = rowWorkdir || metaWorkdir || metaProject;
  return captureHash({
    tool: row.tool,
    workdir,
    prompt: row.prompt,
    response: row.response,
  });
}

export function analysisSearchText(raw: string): string {
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


/** Owns prompt-history queries and persistence behind the PhDB compatibility facade. */
export class PromptRepository {
  constructor(private readonly db: Database.Database, private readonly semanticIndex: SemanticIndex) {}

  /** Prompt schema and search indexes are migrated here; PhDB owns the atomic, cross-domain migration transaction. */
  static migrateSchema(db: Database.Database, getMeta: (key: string) => string | undefined, setMeta: (key: string, value: string) => void): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, tool TEXT NOT NULL,
        prompt TEXT NOT NULL, response TEXT NOT NULL DEFAULT '', args TEXT NOT NULL DEFAULT '',
        workdir TEXT NOT NULL DEFAULT '', hostname TEXT NOT NULL DEFAULT '', exit_code INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}', search_metadata TEXT NOT NULL DEFAULT '',
        prompt_hash TEXT NOT NULL DEFAULT '', capture_hash TEXT NOT NULL DEFAULT ''
      );
    `);
    const columns = (db.prepare('PRAGMA table_info(prompts)').all() as { name: string }[]).map(column => column.name);
    if (!columns.includes('metadata')) db.exec("ALTER TABLE prompts ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'");
    if (!columns.includes('response')) db.exec("ALTER TABLE prompts ADD COLUMN response TEXT NOT NULL DEFAULT ''");
    if (!columns.includes('search_metadata')) db.exec("ALTER TABLE prompts ADD COLUMN search_metadata TEXT NOT NULL DEFAULT ''");
    if (!columns.includes('prompt_hash')) db.exec("ALTER TABLE prompts ADD COLUMN prompt_hash TEXT NOT NULL DEFAULT ''");
    if (!columns.includes('capture_hash')) db.exec("ALTER TABLE prompts ADD COLUMN capture_hash TEXT NOT NULL DEFAULT ''");
    db.exec('CREATE INDEX IF NOT EXISTS idx_prompts_tool ON prompts(tool); CREATE INDEX IF NOT EXISTS idx_prompts_timestamp ON prompts(timestamp);');
    if (!getMeta('database_id')) setMeta('database_id', randomUUID());

    if (!getMeta('search_metadata_backfill_v1')) {
      const rows = db.prepare("SELECT id, metadata FROM prompts WHERE search_metadata = '' AND metadata NOT IN ('', '{}')")
        .all() as { id: number; metadata: string }[];
      const update = db.prepare('UPDATE prompts SET search_metadata = ? WHERE id = ?');
      for (const row of rows) {
        const text = analysisSearchText(row.metadata);
        if (text) update.run(text, row.id);
      }
      setMeta('search_metadata_backfill_v1', 'complete');
    }

    this.migrateSearchIndexes(db);
  }

  private static tableSql(db: Database.Database, name: string): string | undefined {
    return (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name) as { sql: string } | undefined)?.sql;
  }

  private static migrateSearchIndexes(db: Database.Database): void {
    const ftsSql = this.tableSql(db, 'prompts_fts');
    if (!ftsSql?.includes('response') || ftsSql.includes('search_metadata')) {
      db.exec(`
        DROP TABLE IF EXISTS prompts_fts;
        DROP TRIGGER IF EXISTS prompts_ai;
        DROP TRIGGER IF EXISTS prompts_ad;
        DROP TRIGGER IF EXISTS prompts_au;
        CREATE VIRTUAL TABLE prompts_fts USING fts5(prompt, response, tool UNINDEXED, content='prompts', content_rowid='id');
        INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild');
      `);
    }
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS prompts_ai AFTER INSERT ON prompts BEGIN
        INSERT INTO prompts_fts(rowid, prompt, response, tool) VALUES (new.id, new.prompt, new.response, new.tool);
      END;
      CREATE TRIGGER IF NOT EXISTS prompts_ad AFTER DELETE ON prompts BEGIN
        INSERT INTO prompts_fts(prompts_fts, rowid, prompt, response, tool) VALUES('delete', old.id, old.prompt, old.response, old.tool);
      END;
      CREATE TRIGGER IF NOT EXISTS prompts_au AFTER UPDATE OF prompt, response, tool ON prompts BEGIN
        INSERT INTO prompts_fts(prompts_fts, rowid, prompt, response, tool) VALUES('delete', old.id, old.prompt, old.response, old.tool);
        INSERT INTO prompts_fts(rowid, prompt, response, tool) VALUES (new.id, new.prompt, new.response, new.tool);
      END;
    `);

    if (!this.tableSql(db, 'prompts_analysis_fts')?.includes('search_metadata')) {
      db.exec(`
        DROP TABLE IF EXISTS prompts_analysis_fts;
        DROP TRIGGER IF EXISTS prompts_analysis_ai;
        DROP TRIGGER IF EXISTS prompts_analysis_ad;
        DROP TRIGGER IF EXISTS prompts_analysis_au;
        CREATE VIRTUAL TABLE prompts_analysis_fts USING fts5(search_metadata, content='prompts', content_rowid='id');
        INSERT INTO prompts_analysis_fts(prompts_analysis_fts) VALUES('rebuild');
      `);
    }
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS prompts_analysis_ai AFTER INSERT ON prompts BEGIN
        INSERT INTO prompts_analysis_fts(rowid, search_metadata) VALUES (new.id, new.search_metadata);
      END;
      CREATE TRIGGER IF NOT EXISTS prompts_analysis_ad AFTER DELETE ON prompts BEGIN
        INSERT INTO prompts_analysis_fts(prompts_analysis_fts, rowid, search_metadata) VALUES('delete', old.id, old.search_metadata);
      END;
      CREATE TRIGGER IF NOT EXISTS prompts_analysis_au AFTER UPDATE OF search_metadata ON prompts BEGIN
        INSERT INTO prompts_analysis_fts(prompts_analysis_fts, rowid, search_metadata) VALUES('delete', old.id, old.search_metadata);
        INSERT INTO prompts_analysis_fts(rowid, search_metadata) VALUES (new.id, new.search_metadata);
      END;
    `);
  }

  /** `response` is optional at the call site (runtime defaults to ''). */
  insert(entry: Omit<PromptEntry, 'id' | 'response'> & { response?: string }): number {
    const meta = entry.metadata || '{}';
    const response = entry.response ?? '';
    const promptHash = createHash('sha256').update(entry.prompt.trim().toLowerCase()).digest('hex');
    const entryCaptureHash = computeCaptureHashForRow({
      tool: entry.tool,
      workdir: entry.workdir,
      metadata: meta,
      prompt: entry.prompt,
      response,
    });
    const info = this.db
      .prepare(
        `INSERT INTO prompts (timestamp, tool, prompt, response, args, workdir, hostname, exit_code, metadata, search_metadata, prompt_hash, capture_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        analysisSearchText(meta),
        promptHash,
        entryCaptureHash
      );
    return Number(info.lastInsertRowid);
  }

  updateExitCode(id: number, code: number): void {
    this.db.prepare('UPDATE prompts SET exit_code = ? WHERE id = ?').run(code, id);
  }

  updateMetadata(id: number, metadata: string): void {
    const existing = this.getById(id);
    if (existing) {
      const nextCaptureHash = computeCaptureHashForRow({
        tool: existing.tool,
        workdir: existing.workdir,
        metadata,
        prompt: existing.prompt,
        response: existing.response,
      });
      this.db
        .prepare('UPDATE prompts SET metadata = ?, search_metadata = ?, capture_hash = ? WHERE id = ?')
        .run(metadata, analysisSearchText(metadata), nextCaptureHash, id);
      try {
        const parsed: unknown = JSON.parse(metadata);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          this.semanticIndex.syncProject(id, extractProjectFromMetadata(metadata));
        }
      } catch {
        // ignore invalid metadata JSON when syncing semantic partition
      }
      return;
    }
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
    const existing = this.getById(id);
    if (existing) {
      const nextCaptureHash = computeCaptureHashForRow({
        tool: existing.tool,
        workdir: existing.workdir,
        metadata: existing.metadata,
        prompt: existing.prompt,
        response,
      });
      this.db.prepare('UPDATE prompts SET response = ?, capture_hash = ? WHERE id = ?').run(response, nextCaptureHash, id);
      return;
    }
    this.db.prepare('UPDATE prompts SET response = ? WHERE id = ?').run(response, id);
  }

  getById(id: number): PromptEntry | undefined {
    return this.db
      .prepare('SELECT * FROM prompts WHERE id = ?')
      .get(id) as PromptEntry | undefined;
  }
  /**
   * Text search over prompts and responses (BM25) fused with analysis text.
   * Multi-word queries require every term first, then fall back to any
   * meaningful term so natural-language task descriptions still find work.
   * `anyTerms` forces the broad mode directly.
   */
  search(opts: SearchOptions & { anyTerms?: boolean }): PromptEntry[] {
    const ftsArgs: unknown[] = [];
    const ftsFilters: string[] = [];
    const scanArgs: unknown[] = [];
    const scanFilters: string[] = [];

    const add = (fts: string, scan: string, ...values: unknown[]) => {
      ftsFilters.push(fts);
      scanFilters.push(scan);
      ftsArgs.push(...values);
      scanArgs.push(...values);
    };

    if (opts.tool) add('p.tool = ?', 'tool = ?', opts.tool);
    if (opts.project) add("json_valid(p.metadata) AND json_extract(p.metadata, '$.project') = ?", "json_valid(metadata) AND json_extract(metadata, '$.project') = ?", opts.project);
    if (opts.language) add("json_valid(p.metadata) AND json_extract(p.metadata, '$.language') = ?", "json_valid(metadata) AND json_extract(metadata, '$.language') = ?", opts.language);
    if (opts.role) add("json_valid(p.metadata) AND json_extract(p.metadata, '$.role') = ?", "json_valid(metadata) AND json_extract(metadata, '$.role') = ?", opts.role);
    if (opts.tag) add("json_valid(p.metadata) AND json_extract(p.metadata, '$.tags') LIKE ?", "json_valid(metadata) AND json_extract(metadata, '$.tags') LIKE ?", `%"${opts.tag}"%`);
    if (opts.starred) add("json_valid(p.metadata) AND json_extract(p.metadata, '$.starred') = 1", "json_valid(metadata) AND json_extract(metadata, '$.starred') = 1");
    if (opts.minQuality !== undefined) add("json_valid(p.metadata) AND json_extract(p.metadata, '$.quality') >= ?", "json_valid(metadata) AND json_extract(metadata, '$.quality') >= ?", opts.minQuality);
    if (opts.minRelevance !== undefined) add("json_valid(p.metadata) AND json_extract(p.metadata, '$.relevance') >= ?", "json_valid(metadata) AND json_extract(metadata, '$.relevance') >= ?", opts.minRelevance);
    if (opts.since) add('p.timestamp >= ?', 'timestamp >= ?', opts.since.toISOString());
    if (opts.until) add('p.timestamp <= ?', 'timestamp <= ?', opts.until.toISOString());

    const query = opts.query?.trim();
    if (query) {
      const filterClause = ftsFilters.length > 0 ? ' AND ' + ftsFilters.join(' AND ') : '';
      const strict = buildFtsTermsQuery(query, 'AND');
      const broad = buildFtsTermsQuery(query, 'OR');
      if (!strict) return [];
      if (!opts.anyTerms) {
        const rows = this.ftsSearch(strict, filterClause, ftsArgs, opts.limit);
        if (rows.length > 0 || tokenize(query).length < 2 || !broad || broad === strict) return rows;
      }
      return this.ftsSearch(broad ?? strict, filterClause, ftsArgs, opts.limit);
    }

    const filterClause = scanFilters.length > 0 ? ' AND ' + scanFilters.join(' AND ') : '';
    return this.db.prepare(`
      SELECT * FROM prompts
      WHERE 1=1${filterClause}
      ORDER BY timestamp DESC, id DESC
      LIMIT ?
    `).all(...scanArgs, opts.limit) as PromptEntry[];
  }

  private ftsSearch(matchExpr: string, filterClause: string, filterArgs: unknown[], limit: number): PromptEntry[] {
    const sql = `
      WITH raw_matches AS (
        SELECT f.rowid AS id, bm25(prompts_fts) AS score
        FROM prompts_fts f WHERE prompts_fts MATCH ?
      ), raw_ranked AS (
        SELECT m.id, ROW_NUMBER() OVER (ORDER BY m.score ASC, p.timestamp DESC, p.id DESC) AS position
        FROM raw_matches m JOIN prompts p ON p.id = m.id
        WHERE 1=1${filterClause}
      ), analysis_matches AS (
        SELECT f.rowid AS id, bm25(prompts_analysis_fts) AS score
        FROM prompts_analysis_fts f WHERE prompts_analysis_fts MATCH ?
      ), analysis_ranked AS (
        SELECT m.id, ROW_NUMBER() OVER (ORDER BY m.score ASC, p.timestamp DESC, p.id DESC) AS position
        FROM analysis_matches m JOIN prompts p ON p.id = m.id
        WHERE 1=1${filterClause}
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
      ORDER BY r.score DESC, p.timestamp DESC, p.id DESC
      LIMIT ?
    `;
    return this.db.prepare(sql).all(matchExpr, ...filterArgs, matchExpr, ...filterArgs, limit) as PromptEntry[];
  }
  // ─── Semantic index (sqlite-vec) ──────────────────────────────────────────

  saveEmbedding(id: number, vector: Float32Array, model?: string, project?: string): void {
    const resolvedProject = project !== undefined
      ? project
      : extractProjectFromMetadata(this.getById(id)?.metadata);
    this.semanticIndex.save(id, vector, model, resolvedProject);
  }

  /** Nearest neighbours; throws EmbeddingModelMismatchError when `model` differs from stored vectors. */
  searchSemantic(queryVector: Float32Array, limit: number, project?: string, model?: string): PromptEntry[] {
    return this.semanticIndex.search(queryVector, limit, project, model);
  }

  getEmbeddingCount(): number { return this.semanticIndex.count(); }
  getEmbeddingModel(): string | null { return this.semanticIndex.getModel(); }
  clearEmbeddings(): void { this.semanticIndex.clear(); }
  getAllEmbeddings(): Map<number, Float32Array> { return this.semanticIndex.loadAll(); }
  getEmbeddingsForProject(project: string): Map<number, Float32Array> {
    const rows = this.db.prepare(
      `SELECT v.rowid, v.embedding
       FROM vec_embeddings v
       JOIN prompts p ON p.id = v.rowid
       WHERE json_valid(p.metadata) AND json_extract(p.metadata, '$.project') = ?`
    ).all(project) as { rowid: number | bigint; embedding: Buffer }[];
    const map = new Map<number, Float32Array>();
    for (const row of rows) {
      const buffer = row.embedding;
      const vector = new Float32Array(buffer.length / 4);
      for (let i = 0; i < vector.length; i++) vector[i] = buffer.readFloatLE(i * 4);
      map.set(Number(row.rowid), vector);
    }
    return map;
  }

  getPromptsWithoutEmbeddings(): PromptEntry[] {
    return this.semanticIndex.findMissingPrompts();
  }
  // ─── Queries ──────────────────────────────────────────────────────────────

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

  getPromptStats(): { total: number; byTool: Array<{ tool: string; count: number }> } {
    const total = this.getPromptCount();
    const byTool = this.db
      .prepare('SELECT tool, count(*) as count FROM prompts GROUP BY tool ORDER BY count DESC')
      .all() as Array<{ tool: string; count: number }>;
    return { total, byTool };
  }

  getPromptBySyncHash(hash: string): PromptEntry | undefined {
    return this.db
      .prepare("SELECT * FROM prompts WHERE json_valid(metadata) AND json_extract(metadata, '$.sync_hash') = ?")
      .get(hash) as PromptEntry | undefined;
  }

  getPromptIdByHash(hash: string): number | undefined {
    const row = this.db
      .prepare('SELECT id FROM prompts WHERE prompt_hash = ? LIMIT 1')
      .get(hash) as { id: number } | undefined;
    return row?.id;
  }

  getPromptIdByCaptureHash(hash: string): number | undefined {
    const row = this.db
      .prepare('SELECT id FROM prompts WHERE capture_hash = ? LIMIT 1')
      .get(hash) as { id: number } | undefined;
    return row?.id;
  }

  importSyncPrompts(prompts: Array<Partial<PromptEntry>>): { imported: number; skipped: number; errors: string[] } {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    const run = this.db.transaction(() => {
      for (const prompt of prompts) {
        try {
          const tool = prompt.tool || 'unknown';
          const text = prompt.prompt || '';
          const response = prompt.response || '';
          const args = prompt.args || '';
          const hash = syncHash({ tool, prompt: text, response, args });
          if (this.getPromptBySyncHash(hash)) {
            skipped++;
            continue;
          }
          const parsed: unknown = JSON.parse(prompt.metadata || '{}');
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Invalid metadata');
          }
          const metaObj = { ...(parsed as Record<string, unknown>), sync_hash: hash };
          this.insert({
            timestamp: prompt.timestamp || new Date().toISOString(),
            tool,
            prompt: text,
            response,
            args,
            workdir: prompt.workdir || '',
            hostname: prompt.hostname || '',
            exit_code: prompt.exit_code ?? 0,
            metadata: JSON.stringify(metaObj),
          });
          imported++;
        } catch {
          errors.push('record rejected');
        }
      }
    });
    run();
    return { imported, skipped, errors };
  }

  getPromptsByRole(role: string): PromptEntry[] {
    return this.db
      .prepare("SELECT * FROM prompts WHERE json_valid(metadata) AND json_extract(metadata, '$.role') = ? ORDER BY timestamp DESC")
      .all(role) as PromptEntry[];
  }

  /** Most recent interactions captured for a project, analyzed or not. */
  getRecentProjectPrompts(project: string, limit: number = 10): PromptEntry[] {
    return this.db
      .prepare(`
        SELECT * FROM prompts
        WHERE json_valid(metadata) AND json_extract(metadata, '$.project') = ?
        ORDER BY timestamp DESC, id DESC
        LIMIT ?
      `)
      .all(project, limit) as PromptEntry[];
  }

  getAllPromptsByProject(project: string): PromptEntry[] {
    return this.db
      .prepare("SELECT * FROM prompts WHERE json_valid(metadata) AND json_extract(metadata, '$.project') = ? ORDER BY timestamp ASC")
      .all(project) as PromptEntry[];
  }

  getPromptCountByProject(project: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM prompts WHERE json_valid(metadata) AND json_extract(metadata, '$.project') = ?")
      .get(project) as { count: number };
    return row.count;
  }
  delete(id: number): void {
    this.db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
    // vec0 does not participate in foreign keys; remove the vector explicitly.
    this.db.prepare('DELETE FROM vec_embeddings WHERE rowid = ?').run(BigInt(id));
  }

  deleteById(id: number): void {
    this.delete(id);
  }

  deleteByIds(ids: number[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const info = this.db.prepare(`DELETE FROM prompts WHERE id IN (${placeholders})`).run(...ids);
    const delVec = this.db.prepare('DELETE FROM vec_embeddings WHERE rowid = ?');
    for (const id of ids) delVec.run(BigInt(id));
    return info.changes;
  }

  deleteOlderThan(days: number): number {
    const ids = this.db
      .prepare("SELECT id FROM prompts WHERE timestamp < datetime('now', ?)")
      .all(`-${days} days`) as { id: number }[];
    return ids.length > 0 ? this.deleteByIds(ids.map(i => i.id)) : 0;
  }
  getAllPromptHashes(): Map<string, number> {
    const rows = this.db.prepare('SELECT id, prompt, prompt_hash FROM prompts').all() as {
      id: number;
      prompt: string;
      prompt_hash: string;
    }[];
    const map = new Map<string, number>();
    for (const row of rows) {
      const hash = row.prompt_hash || createHash('sha256').update(row.prompt.trim().toLowerCase()).digest('hex');
      map.set(hash, row.id);
    }
    return map;
  }
}
