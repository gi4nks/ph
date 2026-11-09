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

  save(promptId: number, vector: Float32Array, model?: string): void {
    const encoded = this.encode(vector);
    this.db
      .prepare('INSERT OR REPLACE INTO vec_embeddings(rowid, embedding) VALUES (?, vec_f32(?))')
      .run(BigInt(promptId), encoded);
    if (model) this.setModel(model);
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

    const encodedQuery = this.encode(query);
    // sqlite-vec applies k before SQLite evaluates metadata predicates. Scoped
    // searches inspect all stored vectors, then filter by project and limit.
    const projectFilter = project
      ? "AND json_valid(p.metadata) AND json_extract(p.metadata, '$.project') = ?"
      : '';
    const candidateLimit = project ? Math.max(1, totalVectors) : Math.max(1, limit);
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
