import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import * as sqliteVec from 'sqlite-vec';
import type { PromptEntry, SearchOptions, MemoryEntry, ArchivedPromptEntry, MemoryKind, MemoryScope } from '../types.js';
import { SemanticIndex } from './semantic-index.js';
import { MemoryRepository, type AddMemoryInput, type SearchMemoriesOptions } from './memory-repository.js';
import { ArchiveRepository } from './archive-repository.js';
import { PromptRepository } from './prompt-repository.js';

export function defaultPath(): string {
  return path.join(os.homedir(), '.prompt_history.db');
}

function parseJsonArray(raw: unknown): unknown[] {
  try {
    const parsed: unknown = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export class PhDB {
  /**
   * v1/v2: incremental legacy layouts (no response column, BLOB embeddings,
   *        memories + project_summaries + personal_memories silos).
   * v3:    unified memory table and sqlite-vec index.
   * v4:    source/provenance preservation, memory version history, safe backfill.
   */
  static readonly SCHEMA_VERSION = 4;

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
  private promptRepository: PromptRepository;
  private memoryRepository: MemoryRepository;
  private archiveRepository: ArchiveRepository;

  /** Absolute path of the SQLite file. */
  readonly dbPath: string;
  /** Stable identity stored in the database; remote cursors are scoped to it. */
  readonly databaseId: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath, { timeout: 10_000 });
    this.db.pragma('journal_mode = WAL');
    sqliteVec.load(this.db);
    this.migrate();
    this.databaseId = this.getMeta('database_id')!;
    this.semanticIndex = new SemanticIndex(this.db);
    this.promptRepository = new PromptRepository(this.db, this.semanticIndex);
    this.memoryRepository = new MemoryRepository(this.db);
    this.archiveRepository = new ArchiveRepository(this.db);
  }

  // ─── Schema and migrations ────────────────────────────────────────────────

  get schemaVersion(): number {
    return Number(this.getMeta('schema_version') ?? 0);
  }

  private getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM ph_meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  private setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO ph_meta (key, value) VALUES (?, ?)').run(key, value);
  }

  private columns(table: string): string[] {
    return (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(column => column.name);
  }

  private tableSql(name: string): string | undefined {
    const row = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name) as { sql: string } | undefined;
    return row?.sql;
  }

  /**
   * Opening an up-to-date database costs one indexed metadata lookup. Older
   * layouts run a single, idempotent upgrade under an immediate write lock so
   * concurrent hook processes cannot migrate the same file twice.
   */
  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS ph_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    if (this.schemaVersion >= PhDB.SCHEMA_VERSION) return;

    const upgrade = this.db.transaction(() => {
      if (this.schemaVersion >= PhDB.SCHEMA_VERSION) return;
      PromptRepository.migrateSchema(this.db, key => this.getMeta(key), (key, value) => this.setMeta(key, value));
      this.upgradeVectors();
      this.upgradeMemories();
      this.upgradeMemoryProvenance();
      this.db.exec(PhDB.ARCHIVE_SCHEMA);
      this.setMeta('schema_version', String(PhDB.SCHEMA_VERSION));
    });
    upgrade.immediate();
  }

  private upgradeVectors(): void {
    const vecSql = this.tableSql('vec_embeddings');
    if (vecSql && !vecSql.includes('vec0')) this.db.exec('DROP TABLE vec_embeddings');
    this.db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(embedding float[768])');

    // Retire the legacy BLOB table: copy vectors once, then drop it so every
    // consumer reads the same sqlite-vec index.
    if (this.tableSql('embeddings')) {
      const vecCount = (this.db.prepare('SELECT count(*) AS c FROM vec_embeddings').get() as { c: number }).c;
      if (vecCount === 0) {
        const rows = this.db.prepare('SELECT prompt_id, vector FROM embeddings').all() as { prompt_id: number; vector: Buffer }[];
        const insert = this.db.prepare('INSERT OR REPLACE INTO vec_embeddings(rowid, embedding) VALUES (?, vec_f32(?))');
        for (const row of rows) {
          if (row.vector.length === 768 * 4) insert.run(BigInt(row.prompt_id), row.vector);
        }
      }
      this.db.exec('DROP TABLE embeddings');
    }
  }

  private upgradeMemories(): void {
    const memoryColumns = this.columns('memories');
    const hasLegacyMemories = memoryColumns.length > 0 && !memoryColumns.includes('content');
    if (hasLegacyMemories) this.db.exec('ALTER TABLE memories RENAME TO memories_legacy');

    this.db.exec(MemoryRepository.SCHEMA);
    const insert = this.db.prepare(`
      INSERT INTO memories (content, scope, project, kind, prompt_ids, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    if (hasLegacyMemories) {
      const rows = this.db.prepare('SELECT * FROM memories_legacy ORDER BY id ASC').all() as Record<string, unknown>[];
      for (const row of rows) {
        const summary = String(row.summary ?? '').trim();
        const insights = parseJsonArray(row.key_insights).filter((value): value is string => typeof value === 'string' && value.trim() !== '');
        const decisions = parseJsonArray(row.technical_decisions).filter((value): value is string => typeof value === 'string' && value.trim() !== '');
        const content = [summary, ...insights.map(value => `Insight: ${value}`), ...decisions.map(value => `Decision: ${value}`)]
          .filter(Boolean).join('\n');
        if (!content) continue;
        const project = String(row.project ?? '').trim();
        const promptIds = parseJsonArray(row.prompt_ids).filter((id): id is number => Number.isInteger(id) && Number(id) > 0);
        const createdAt = String(row.created_at ?? new Date().toISOString());
        insert.run(content, project ? 'project' : 'work', project, 'decision', JSON.stringify(promptIds),
          'active', createdAt, String(row.updated_at ?? createdAt));
      }
      this.db.exec('DROP TABLE memories_legacy');
    }

    if (this.tableSql('personal_memories')) {
      const rows = this.db.prepare('SELECT * FROM personal_memories ORDER BY created_at ASC').all() as Record<string, unknown>[];
      const insertPersonal = this.db.prepare(`
        INSERT INTO memories
          (content, scope, project, kind, prompt_ids, status, created_at, updated_at,
           sensitivity, source, source_ref, external_id, forgotten_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of rows) {
        const content = String(row.content ?? '').trim();
        if (!content) continue;
        const sensitive = row.sensitivity === 'sensitive';
        const legacyScope = String(row.scope ?? 'personal');
        const scope: MemoryScope = legacyScope === 'project' ? 'project' : legacyScope === 'work' ? 'work' : 'personal';
        const legacyKind = String(row.kind ?? row.category ?? '').toLowerCase();
        const kind: MemoryKind = legacyKind.includes('preference') ? 'preference'
          : legacyKind.includes('decision') || legacyKind.includes('knowledge') ? 'decision'
            : legacyKind.includes('insight') ? 'insight' : 'fact';
        const promptIds = [...String(row.source_ref ?? '').matchAll(/prompt:(\d+)/g)].map(match => Number(match[1]));
        const createdAt = String(row.created_at ?? new Date().toISOString());
        const sourceRef = row.source_ref == null ? null : String(row.source_ref);
        insertPersonal.run(content, scope, '', kind, JSON.stringify([...new Set(promptIds)]),
          row.status === 'forgotten' ? 'forgotten' : 'active', createdAt, String(row.updated_at ?? createdAt),
          sensitive ? 'sensitive' : 'normal', String(row.source ?? 'legacy'), sourceRef, String(row.id),
          row.forgotten_at == null ? null : String(row.forgotten_at));
      }
    }

    // Keep project_summaries and its original metadata intact. It is historical
    // user data; the unified-memory transition must never infer that it is disposable.
  }

  private upgradeMemoryProvenance(): void {
    const columns = new Set(this.columns('memories'));
    if (!columns.has('sensitivity')) this.db.exec("ALTER TABLE memories ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'normal'");
    if (!columns.has('source')) this.db.exec("ALTER TABLE memories ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy'");
    if (!columns.has('source_ref')) this.db.exec('ALTER TABLE memories ADD COLUMN source_ref TEXT');
    if (!columns.has('external_id')) this.db.exec('ALTER TABLE memories ADD COLUMN external_id TEXT');
    if (!columns.has('forgotten_at')) this.db.exec('ALTER TABLE memories ADD COLUMN forgotten_at TEXT');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        scope TEXT NOT NULL,
        kind TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        source TEXT NOT NULL,
        source_ref TEXT,
        status TEXT NOT NULL,
        changed_at TEXT NOT NULL,
        legacy_memory_id TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_external_id
        ON memories(external_id) WHERE external_id IS NOT NULL;
    `);

    if (this.tableSql('personal_memory_versions')) {
      const rows = this.db.prepare('SELECT * FROM personal_memory_versions ORDER BY changed_at, rowid').all() as Record<string, unknown>[];
      const findMemory = this.db.prepare('SELECT id FROM memories WHERE external_id = ?');
      const insertVersion = this.db.prepare(`INSERT INTO memory_versions
        (memory_id, content, scope, kind, sensitivity, source, source_ref, status, changed_at, legacy_memory_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const row of rows) {
        const legacyId = String(row.memory_id ?? '');
        const memory = findMemory.get(legacyId) as { id: number } | undefined;
        if (!memory) continue;
        insertVersion.run(memory.id, String(row.content ?? ''), String(row.scope ?? 'personal'),
          String(row.kind ?? 'fact'), String(row.sensitivity ?? 'normal'), String(row.source ?? 'legacy'),
          row.source_ref == null ? null : String(row.source_ref), String(row.status ?? 'active'),
          String(row.changed_at ?? new Date().toISOString()), legacyId);
      }
    }
  }

  // ─── Prompt-history facade ────────────────────────────────────────────────

  insert(entry: Omit<PromptEntry, 'id' | 'response'> & { response?: string }): number { return this.promptRepository.insert(entry); }
  updateExitCode(id: number, code: number): void { this.promptRepository.updateExitCode(id, code); }
  updateMetadata(id: number, metadata: string): void { this.promptRepository.updateMetadata(id, metadata); }
  updateMetadataFields(id: number, patch: Record<string, unknown>): void { this.promptRepository.updateMetadataFields(id, patch); }
  updateResponse(id: number, response: string): void { this.promptRepository.updateResponse(id, response); }
  getById(id: number): PromptEntry | undefined { return this.promptRepository.getById(id); }
  getArchivedById(id: number): ArchivedPromptEntry | undefined { return this.archiveRepository.getByOriginalIdOrArchiveId(id); }
  search(opts: SearchOptions & { anyTerms?: boolean }): PromptEntry[] { return this.promptRepository.search(opts); }

  saveEmbedding(id: number, vector: Float32Array, model?: string): void { this.promptRepository.saveEmbedding(id, vector, model); }
  searchSemantic(queryVector: Float32Array, limit: number, project?: string, model?: string): PromptEntry[] {
    return this.promptRepository.searchSemantic(queryVector, limit, project, model);
  }
  getEmbeddingCount(): number { return this.promptRepository.getEmbeddingCount(); }
  getEmbeddingModel(): string | null { return this.promptRepository.getEmbeddingModel(); }
  clearEmbeddings(): void { this.promptRepository.clearEmbeddings(); }
  getAllEmbeddings(): Map<number, Float32Array> { return this.promptRepository.getAllEmbeddings(); }
  getEmbeddingsForProject(project: string): Map<number, Float32Array> { return this.promptRepository.getEmbeddingsForProject(project); }
  getPromptsWithoutEmbeddings(): PromptEntry[] { return this.promptRepository.getPromptsWithoutEmbeddings(); }

  getAllPrompts(limit: number = 1000000): PromptEntry[] { return this.promptRepository.getAllPrompts(limit); }
  getPromptsSince(timestamp: string, limit: number = 10000): PromptEntry[] { return this.promptRepository.getPromptsSince(timestamp, limit); }
  getPromptsAfterId(id: number, limit: number): PromptEntry[] { return this.promptRepository.getPromptsAfterId(id, limit); }
  getPromptCountAfterId(id: number): number { return this.promptRepository.getPromptCountAfterId(id); }
  getPromptCount(): number { return this.promptRepository.getPromptCount(); }
  getPromptCountSince(timestamp: string): number { return this.promptRepository.getPromptCountSince(timestamp); }
  getStats(): { total: number; totalMemories: number; byTool: Array<{ tool: string; count: number }> } {
    return { ...this.promptRepository.getPromptStats(), totalMemories: this.memoryRepository.countActive() };
  }
  getPromptBySyncHash(hash: string): PromptEntry | undefined { return this.promptRepository.getPromptBySyncHash(hash); }
  getPromptsByRole(role: string): PromptEntry[] { return this.promptRepository.getPromptsByRole(role); }
  getRecentProjectPrompts(project: string, limit: number = 10): PromptEntry[] { return this.promptRepository.getRecentProjectPrompts(project, limit); }
  getAllPromptsByProject(project: string): PromptEntry[] { return this.promptRepository.getAllPromptsByProject(project); }
  getPromptCountByProject(project: string): number { return this.promptRepository.getPromptCountByProject(project); }

  delete(id: number): void { this.promptRepository.delete(id); }
  deleteById(id: number): void { this.promptRepository.deleteById(id); }
  deleteByIds(ids: number[]): number { return this.promptRepository.deleteByIds(ids); }
  deleteOlderThan(days: number): number { return this.promptRepository.deleteOlderThan(days); }
  archivePrompts(ids: number[]): number { return this.archiveRepository.archivePrompts(ids); }
  searchArchive(opts: { since?: string; until?: string; limit?: number }): Array<Record<string, unknown>> { return this.archiveRepository.searchArchive(opts); }
  purgeArchive(beforeDate: string): number { return this.archiveRepository.purgeArchive(beforeDate); }
  getArchiveStats(): { total: number; oldest: string | null; newest: string | null } { return this.archiveRepository.getArchiveStats(); }
  vacuum(): void { this.db.exec('VACUUM'); }
  getAllPromptHashes(): Map<string, number> { return this.promptRepository.getAllPromptHashes(); }

  // ─── Unified memory ───────────────────────────────────────────────────────

  addMemory(input: AddMemoryInput): MemoryEntry {
    this.validateMemorySources(input);
    return this.memoryRepository.add(input);
  }

  validateMemorySources(input: AddMemoryInput): void {
    const promptIds = input.prompt_ids ?? [];
    const project = (input.project ?? '').trim();
    for (const id of promptIds) {
      const source = this.getById(id);
      if (!source) throw new Error(`Source prompt #${id} does not exist.`);
      if ((input.scope ?? (project ? 'project' : 'work')) === 'project') {
        let sourceProject = '';
        try { sourceProject = String((JSON.parse(source.metadata) as { project?: unknown }).project ?? '').trim(); } catch {}
        if (sourceProject !== project) {
          throw new Error(`Source prompt #${id} belongs to project "${sourceProject || '(unknown)'}", not "${project}".`);
        }
      }
    }
  }

  getMemoryById(id: number): MemoryEntry | undefined { return this.memoryRepository.getById(id); }
  getMemoryByExternalId(id: string): MemoryEntry | undefined { return this.memoryRepository.getByExternalId(id); }
  searchMemories(options: SearchMemoriesOptions = {}): MemoryEntry[] { return this.memoryRepository.search(options); }
  getAllMemories(): MemoryEntry[] { return this.memoryRepository.search({ limit: 10_000, includePersonal: true, includeForgotten: true }); }
  getAllMemoriesByProject(project: string): MemoryEntry[] { return this.memoryRepository.getAllByProject(project); }
  forgetMemory(id: number): boolean { return this.memoryRepository.forget(id); }
  restoreMemory(id: number): boolean { return this.memoryRepository.restore(id); }
  deleteMemory(id: number): boolean { return this.memoryRepository.delete(id); }

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

export { EmbeddingModelMismatchError } from './semantic-index.js';
export type { AddMemoryInput, SearchMemoriesOptions } from './memory-repository.js';
