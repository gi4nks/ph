import type Database from 'better-sqlite3';
import type { MemoryEntry, MemoryKind, MemoryScope, MemoryStatus } from '../types.js';
import { buildFtsTermsQuery } from './fts.js';

export interface AddMemoryInput {
  content: string;
  scope?: MemoryScope;
  project?: string;
  kind?: MemoryKind;
  prompt_ids?: number[];
  status?: MemoryStatus;
  created_at?: string;
  updated_at?: string;
  sensitivity?: 'normal' | 'sensitive';
  source?: string;
  source_ref?: string;
  external_id?: string;
  forgotten_at?: string;
}

export interface SearchMemoriesOptions {
  query?: string;
  project?: string;
  scope?: MemoryScope;
  includePersonal?: boolean;
  includeSensitive?: boolean;
  includeForgotten?: boolean;
  limit?: number;
}

export class MemoryRepository {
  static readonly SCHEMA = `
    CREATE TABLE IF NOT EXISTS memories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      content     TEXT    NOT NULL,
      scope       TEXT    NOT NULL DEFAULT 'project' CHECK (scope IN ('project', 'work', 'personal')),
      project     TEXT    NOT NULL DEFAULT '',
      kind        TEXT    NOT NULL DEFAULT 'decision' CHECK (kind IN ('decision', 'insight', 'preference', 'fact')),
      prompt_ids  TEXT    NOT NULL DEFAULT '[]',
      status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'forgotten')),
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
      ,sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal', 'sensitive'))
      ,source      TEXT NOT NULL DEFAULT 'manual'
      ,source_ref  TEXT
      ,external_id TEXT
      ,forgotten_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_memories_project_status ON memories(project, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_scope_status   ON memories(scope, status, updated_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      project,
      kind,
      content='memories',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, project, kind)
        VALUES (new.id, new.content, new.project, new.kind);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, project, kind)
        VALUES('delete', old.id, old.content, old.project, old.kind);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF content, project, kind ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, project, kind)
        VALUES('delete', old.id, old.content, old.project, old.kind);
      INSERT INTO memories_fts(rowid, content, project, kind)
        VALUES (new.id, new.content, new.project, new.kind);
    END;
  `;

  constructor(private readonly db: Database.Database) {}

  add(input: AddMemoryInput): MemoryEntry {
    const content = input.content.trim();
    if (!content) throw new Error('Memory content cannot be empty.');
    if (content.length > 8000) throw new Error('Memory content must be 8000 characters or fewer.');

    const scope: MemoryScope = input.scope ?? (input.project ? 'project' : 'work');
    const project = (input.project ?? '').trim();
    if (scope === 'project' && !project) {
      throw new Error('Project-scoped memories require a project name.');
    }
    const kind: MemoryKind = input.kind ?? 'decision';
    const status: MemoryStatus = input.status ?? 'active';
    const promptIds = [...new Set((input.prompt_ids ?? []).filter(id => Number.isInteger(id) && id > 0))];

    if (input.external_id) {
      const external = this.db.prepare('SELECT * FROM memories WHERE external_id = ? LIMIT 1').get(input.external_id) as Record<string, unknown> | undefined;
      if (external) {
        const existing = this.hydrate(external);
        if (existing.content !== content || existing.scope !== scope || existing.project !== project) {
          throw new Error('memory id already exists with different content');
        }
        return existing;
      }
    }

    const duplicate = this.db.prepare(`
      SELECT * FROM memories
      WHERE content = ? AND scope = ? AND project = ? AND kind = ? AND status = 'active'
      LIMIT 1
    `).get(content, scope, project, kind) as Record<string, unknown> | undefined;

    if (duplicate) {
      const existing = this.hydrate(duplicate);
      const mergedIds = [...new Set([...existing.prompt_ids, ...promptIds])];
      if (mergedIds.length !== existing.prompt_ids.length) {
        const now = input.updated_at ?? new Date().toISOString();
        this.db.prepare('UPDATE memories SET prompt_ids = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(mergedIds), now, existing.id);
        return this.getById(existing.id)!;
      }
      return existing;
    }

    const now = new Date().toISOString();
    const createdAt = input.created_at ?? now;
    const updatedAt = input.updated_at ?? createdAt;

    const info = this.db.prepare(`
      INSERT INTO memories (content, scope, project, kind, prompt_ids, status, created_at, updated_at, sensitivity, source, source_ref, external_id, forgotten_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(content, scope, project, kind, JSON.stringify(promptIds), status, createdAt, updatedAt,
      input.sensitivity ?? 'normal', input.source ?? 'manual', input.source_ref ?? null,
      input.external_id ?? null, input.forgotten_at ?? null);

    return this.getById(Number(info.lastInsertRowid))!;
  }

  getById(id: number): MemoryEntry | undefined {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  getByExternalId(id: string): MemoryEntry | undefined {
    const row = this.db.prepare('SELECT * FROM memories WHERE external_id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  search(options: SearchMemoriesOptions = {}): MemoryEntry[] {
    const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 10), 100));
    const clauses: string[] = [];
    const filterParams: unknown[] = [];

    if (!options.includeForgotten) {
      clauses.push("m.status = 'active'");
    }
    if (!options.includePersonal && options.scope !== 'personal') {
      clauses.push("m.scope != 'personal'");
    }
    if (!options.includeSensitive) clauses.push("m.sensitivity != 'sensitive'");
    if (options.scope) {
      clauses.push('m.scope = ?');
      filterParams.push(options.scope);
    }
    if (options.project !== undefined) {
      clauses.push('m.project = ?');
      filterParams.push(options.project);
    }

    const whereSql = clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '';
    const query = options.query?.trim();

    if (query) {
      const andExpr = buildFtsTermsQuery(query, 'AND');
      if (andExpr) {
        const strictRows = this.runFtsSearch(andExpr, whereSql, filterParams, limit);
        if (strictRows.length > 0) return strictRows;
        const orExpr = buildFtsTermsQuery(query, 'OR');
        if (orExpr && orExpr !== andExpr) {
          return this.runFtsSearch(orExpr, whereSql, filterParams, limit);
        }
      }
      return [];
    }

    const scanWhere = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT m.* FROM memories m
      ${scanWhere}
      ORDER BY m.updated_at DESC, m.id DESC
      LIMIT ?
    `).all(...filterParams, limit) as Record<string, unknown>[];
    return rows.map(row => this.hydrate(row));
  }

  getAllByProject(project: string): MemoryEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE project = ? AND status = 'active'
      ORDER BY created_at ASC, id ASC
    `).all(project) as Record<string, unknown>[];
    return rows.map(row => this.hydrate(row));
  }

  forget(id: number): boolean {
    return this.setStatus(id, 'forgotten');
  }

  restore(id: number): boolean {
    return this.setStatus(id, 'active');
  }

  delete(id: number): boolean {
    const info = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return info.changes > 0;
  }

  countActive(): number {
    return (this.db.prepare("SELECT count(*) AS c FROM memories WHERE status = 'active'").get() as { c: number }).c;
  }

  private setStatus(id: number, status: MemoryStatus): boolean {
    const current = this.getById(id);
    if (!current || current.status === status) return false;
    const now = new Date().toISOString();
    const update = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO memory_versions
        (memory_id, content, scope, kind, sensitivity, source, source_ref, status, changed_at, legacy_memory_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(current.id, current.content, current.scope, current.kind, current.sensitivity, current.source,
          current.source_ref ?? null, current.status, now, current.external_id ?? null);
      this.db.prepare('UPDATE memories SET status = ?, updated_at = ?, forgotten_at = ? WHERE id = ?')
        .run(status, now, status === 'forgotten' ? now : null, id);
    });
    update();
    return true;
  }

  private runFtsSearch(matchExpr: string, whereSql: string, filterParams: unknown[], limit: number): MemoryEntry[] {
    const rows = this.db.prepare(`
      SELECT m.*, bm25(memories_fts) AS rank
      FROM memories_fts f
      JOIN memories m ON m.id = f.rowid
      WHERE memories_fts MATCH ?
      ${whereSql}
      ORDER BY rank ASC, m.updated_at DESC, m.id DESC
      LIMIT ?
    `).all(matchExpr, ...filterParams, limit) as Record<string, unknown>[];
    return rows.map(row => this.hydrate(row));
  }

  private hydrate(row: Record<string, unknown>): MemoryEntry {
    let promptIds: number[] = [];
    try {
      const parsed: unknown = JSON.parse(String(row.prompt_ids ?? '[]'));
      if (Array.isArray(parsed)) {
        promptIds = parsed.filter((id): id is number => Number.isInteger(id) && id > 0);
      }
    } catch { /* ignore malformed prompt_ids */ }

    return {
      id: Number(row.id),
      content: String(row.content),
      scope: row.scope as MemoryScope,
      project: String(row.project ?? ''),
      kind: row.kind as MemoryKind,
      prompt_ids: promptIds,
      status: row.status as MemoryStatus,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      sensitivity: row.sensitivity === 'sensitive' ? 'sensitive' : 'normal',
      source: String(row.source ?? 'manual'),
      ...(row.source_ref ? { source_ref: String(row.source_ref) } : {}),
      ...(row.external_id ? { external_id: String(row.external_id) } : {}),
      ...(row.forgotten_at ? { forgotten_at: String(row.forgotten_at) } : {}),
    };
  }
}
