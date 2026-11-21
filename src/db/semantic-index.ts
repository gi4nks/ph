import type Database from 'better-sqlite3';
import type { PromptEntry } from '../types.js';

export class EmbeddingModelMismatchError extends Error {
  constructor(
    public readonly storedModel: string,
    public readonly requestedModel: string,
  ) {
    super(
      `Stored vectors were built with "${storedModel}", but "${requestedModel}" is configured. Run \`ph embed-all --force\` to rebuild.`,
    );
    this.name = 'EmbeddingModelMismatchError';
  }
}

/** Owns sqlite-vec storage, model provenance, and nearest-neighbor queries. */
export class SemanticIndex {
  constructor(private readonly db: Database.Database) {}

  getModel(): string | null {
    const row = this.db
      .prepare("SELECT value FROM ph_meta WHERE key = 'embedding_model'")
      .get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  setModel(model: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO ph_meta (key, value) VALUES ('embedding_model', ?)")
      .run(model);
  }

  getDim(): number {
    const row = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_embeddings'")
      .get() as { sql?: string } | undefined;
    const match = row?.sql?.match(/float\[(\d+)\]/i);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    }
    const meta = this.db
      .prepare("SELECT value FROM ph_meta WHERE key = 'embedding_dim'")
      .get() as { value: string } | undefined;
    return Number(meta?.value) || 768;
  }

  hasPartitionKey(): boolean {
    const row = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_embeddings'")
      .get() as { sql?: string } | undefined;
    return Boolean(row?.sql && /partition\s+key/i.test(row.sql));
  }

  migrateToPartitioned(): void {
    if (this.hasPartitionKey()) return;

    const tableRow = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_embeddings'")
      .get() as { sql?: string } | undefined;
    const dim = this.getDim();

    const existingRows = tableRow?.sql
      ? (this.db.prepare(`
          SELECT v.rowid AS rowid, v.embedding AS embedding,
            CASE WHEN p.id IS NOT NULL AND json_valid(p.metadata)
              THEN COALESCE(json_extract(p.metadata, '$.project'), '')
              ELSE ''
            END AS project
          FROM vec_embeddings v
          LEFT JOIN prompts p ON p.id = v.rowid
          WHERE v.rowid IN (SELECT id FROM prompts)
        `).all() as { rowid: number | bigint; embedding: unknown; project: unknown }[])
      : [];

    this.db.exec('DROP TABLE IF EXISTS vec_embeddings');
    this.db.exec(`CREATE VIRTUAL TABLE vec_embeddings USING vec0(project text partition key, embedding float[${dim}])`);

    if (existingRows.length > 0) {
      const insert = this.db.prepare('INSERT INTO vec_embeddings(rowid, project, embedding) VALUES (?, ?, vec_f32(?))');
      for (const row of existingRows) {
        if (!Buffer.isBuffer(row.embedding) || row.embedding.length !== dim * 4) continue;
        const project = typeof row.project === 'string' ? row.project : '';
        insert.run(BigInt(row.rowid), project, row.embedding);
      }
    }
  }

  count(): number {
    return (this.db.prepare('SELECT count(*) AS count FROM vec_embeddings').get() as { count: number }).count;
  }

  clear(): void {
    const reset = this.db.transaction(() => {
      this.db.exec('DELETE FROM vec_embeddings');
      this.db.prepare("DELETE FROM ph_meta WHERE key = 'embedding_model'").run();
    });
    reset();
  }

  save(promptId: number, vector: Float32Array, model?: string, project = ''): void {
    if (vector.length === 0) {
      throw new Error('Embedding vector cannot be empty.');
    }
    const persist = this.db.transaction(() => {
      const currentDim = this.getDim();
      if (vector.length !== currentDim) {
        if (this.count() === 0) {
          this.db.exec('DROP TABLE IF EXISTS vec_embeddings');
          this.db.exec(`CREATE VIRTUAL TABLE vec_embeddings USING vec0(project text partition key, embedding float[${vector.length}])`);
          this.db
            .prepare("INSERT OR REPLACE INTO ph_meta (key, value) VALUES ('embedding_dim', ?)")
            .run(String(vector.length));
        } else {
          throw new Error(
            `Embedding dimension mismatch: stored vectors use ${currentDim}, got ${vector.length}. Run \`ph embed-all --force\` to rebuild.`,
          );
        }
      } else if (!this.hasPartitionKey()) {
        this.migrateToPartitioned();
      }
      const encoded = this.encode(vector);
      // Partitioned vec0 tables in sqlite-vec v0.1.9 reject INSERT OR REPLACE with UNIQUE constraint failed.
      this.db.prepare('DELETE FROM vec_embeddings WHERE rowid = ?').run(BigInt(promptId));
      this.db
        .prepare('INSERT INTO vec_embeddings(rowid, project, embedding) VALUES (?, ?, vec_f32(?))')
        .run(BigInt(promptId), project, encoded);
      if (model) this.setModel(model);
    });
    persist();
  }

  syncProject(promptId: number, project: string): void {
    if (!this.hasPartitionKey()) return;
    const sync = this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT project, embedding FROM vec_embeddings WHERE rowid = ?')
        .get(BigInt(promptId)) as { project: string; embedding: Buffer } | undefined;
      if (!row || row.project === project) return;
      this.db.prepare('DELETE FROM vec_embeddings WHERE rowid = ?').run(BigInt(promptId));
      this.db
        .prepare('INSERT INTO vec_embeddings(rowid, project, embedding) VALUES (?, ?, vec_f32(?))')
        .run(BigInt(promptId), project, row.embedding);
    });
    sync();
  }

  assertModelCompatible(expectedModel?: string): void {
    if (!expectedModel) return;
    const stored = this.getModel();
    if (stored && stored !== expectedModel && this.count() > 0) {
      throw new EmbeddingModelMismatchError(stored, expectedModel);
    }
  }

  search(query: Float32Array, limit: number, project?: string, expectedModel?: string): PromptEntry[] {
    this.assertModelCompatible(expectedModel);
    const totalVectors = this.count();
    if (totalVectors === 0) return [];

    const currentDim = this.getDim();
    if (query.length !== currentDim) {
      throw new Error(
        `Embedding dimension mismatch: stored vectors use ${currentDim}, query has ${query.length}. Run \`ph embed-all --force\` to rebuild.`,
      );
    }

    const encodedQuery = this.encode(query);
    const candidateLimit = Math.max(1, limit);
    if (project) {
      if (this.hasPartitionKey()) {
        return this.db.prepare(`
          SELECT p.*, v.distance
          FROM vec_embeddings v
          JOIN prompts p ON p.id = v.rowid
          WHERE v.embedding MATCH vec_f32(?) AND v.project = ? AND k = ?
          ORDER BY v.distance ASC
          LIMIT ?
        `).all(encodedQuery, project, candidateLimit, candidateLimit) as PromptEntry[];
      }
      const fallbackLimit = Math.max(1, totalVectors);
      return this.db.prepare(`
        SELECT p.*, v.distance
        FROM vec_embeddings v
        JOIN prompts p ON p.id = v.rowid
        WHERE v.embedding MATCH vec_f32(?) AND k = ?
        AND json_valid(p.metadata) AND json_extract(p.metadata, '$.project') = ?
        ORDER BY v.distance ASC
        LIMIT ?
      `).all(encodedQuery, fallbackLimit, project, candidateLimit) as PromptEntry[];
    }

    return this.db.prepare(`
      SELECT p.*, v.distance
      FROM vec_embeddings v
      JOIN prompts p ON p.id = v.rowid
      WHERE v.embedding MATCH vec_f32(?) AND k = ?
      ORDER BY v.distance ASC
      LIMIT ?
    `).all(encodedQuery, candidateLimit, candidateLimit) as PromptEntry[];
  }

  findMissingPrompts(): PromptEntry[] {
    return this.db.prepare(
      `SELECT p.* FROM prompts p
       LEFT JOIN vec_embeddings e ON e.rowid = p.id
       WHERE e.rowid IS NULL`,
    ).all() as PromptEntry[];
  }

  loadAll(): Map<number, Float32Array> {
    const rows = this.db.prepare('SELECT rowid, embedding FROM vec_embeddings').all() as { rowid: number | bigint; embedding: Buffer }[];
    return new Map(rows.map(row => [Number(row.rowid), this.decode(row.embedding)]));
  }

  loadByIds(ids: number[]): Map<number, Float32Array> {
    const result = new Map<number, Float32Array>();
    if (ids.length === 0) return result;
    const uniqueIds = [...new Set(ids)];
    for (let i = 0; i < uniqueIds.length; i += 500) {
      const chunk = uniqueIds.slice(i, i + 500);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.db
        .prepare(`SELECT rowid, embedding FROM vec_embeddings WHERE rowid IN (${placeholders})`)
        .all(...chunk) as { rowid: number | bigint; embedding: Buffer }[];
      for (const row of rows) {
        result.set(Number(row.rowid), this.decode(row.embedding));
      }
    }
    return result;
  }

  private decode(buffer: Buffer): Float32Array {
    const vector = new Float32Array(buffer.length / 4);
    for (let i = 0; i < vector.length; i++) vector[i] = buffer.readFloatLE(i * 4);
    return vector;
  }

  private encode(vector: Float32Array): Buffer {
    const buffer = Buffer.alloc(vector.length * 4);
    for (let i = 0; i < vector.length; i++) buffer.writeFloatLE(vector[i], i * 4);
    return buffer;
  }
}
