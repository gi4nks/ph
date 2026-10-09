import type Database from 'better-sqlite3';
import type { PromptEntry } from '../types.js';

/** Owns vector encoding, compatibility storage, and semantic nearest-neighbor queries. */
export class SemanticIndex {
  constructor(private readonly db: Database.Database) {}

  save(promptId: number, vector: Float32Array): void {
    const encoded = this.encode(vector);
    // Keep the legacy BLOB table populated while older databases migrate.
    this.db.prepare('INSERT OR REPLACE INTO embeddings (prompt_id, vector) VALUES (?, ?)').run(promptId, encoded);
    this.db.prepare('INSERT OR REPLACE INTO vec_embeddings(rowid, embedding) VALUES (?, vec_f32(?))').run(BigInt(promptId), encoded);
  }

  search(query: Float32Array, limit: number, project?: string): PromptEntry[] {
    const encodedQuery = this.encode(query);
    // sqlite-vec applies k before SQLite evaluates metadata predicates. Scoped
    // searches therefore inspect all vectors, then filter and apply the limit.
    const projectFilter = project ? "AND json_extract(p.metadata, '$.project') = ?" : '';
    const candidateLimit = project
      ? Math.max(1, (this.db.prepare('SELECT count(*) AS count FROM vec_embeddings').get() as { count: number }).count)
      : limit;
    const sql = `
      SELECT p.*, v.distance
      FROM vec_embeddings v
      JOIN prompts p ON p.id = v.rowid
      WHERE v.embedding MATCH vec_f32(?) AND k = ?
      ${projectFilter}
      ORDER BY v.distance ASC
    `;
    return this.db.prepare(project ? `${sql} LIMIT ?` : sql).all(
      encodedQuery,
      candidateLimit,
      ...(project ? [project, limit] : []),
    ) as PromptEntry[];
  }

  loadAll(): Map<number, Float32Array> {
    const rows = this.db.prepare('SELECT prompt_id, vector FROM embeddings').all() as { prompt_id: number; vector: Buffer }[];
    return new Map(rows.map(row => [row.prompt_id, this.decode(row.vector)]));
  }

  findMissingPrompts(): PromptEntry[] {
    return this.db.prepare(
      `SELECT p.* FROM prompts p
       LEFT JOIN vec_embeddings e ON e.rowid = p.id
       WHERE e.rowid IS NULL`,
    ).all() as PromptEntry[];
  }

  private encode(vector: Float32Array): Buffer {
    const buffer = Buffer.alloc(vector.length * 4);
    for (let i = 0; i < vector.length; i++) buffer.writeFloatLE(vector[i], i * 4);
    return buffer;
  }

  private decode(buffer: Buffer): Float32Array {
    const vector = new Float32Array(buffer.length / 4);
    for (let i = 0; i < vector.length; i++) vector[i] = buffer.readFloatLE(i * 4);
    return vector;
  }
}
