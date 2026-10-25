import type Database from 'better-sqlite3';
import type { PersonalMemory, PersonalMemoryScope, PersonalMemorySensitivity } from '../types.js';

export class PersonalMemoryRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: {
    id: string; content: string; scope: PersonalMemoryScope; kind: string;
    sensitivity: PersonalMemorySensitivity; source: string; source_ref?: string;
  }): PersonalMemory {
    const existing = this.get(input.id);
    if (existing) {
      const same = existing.content === input.content && existing.scope === input.scope && existing.kind === input.kind
        && existing.sensitivity === input.sensitivity && existing.source === input.source
        && existing.source_ref === input.source_ref;
      if (!same) throw new Error('memory id already exists with different content');
      return existing;
    }
    const duplicate = this.db.prepare(`SELECT * FROM personal_memories
      WHERE content = ? AND scope = ? AND kind = ? AND sensitivity = ? AND source = ?
        AND COALESCE(source_ref, '') = COALESCE(?, '') AND status = 'active'
      LIMIT 1`).get(input.content, input.scope, input.kind, input.sensitivity, input.source, input.source_ref ?? null) as Record<string, unknown> | undefined;
    if (duplicate) return this.hydrate(duplicate);
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO personal_memories
      (id, content, scope, kind, sensitivity, source, source_ref, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
      .run(input.id, input.content, input.scope, input.kind, input.sensitivity, input.source, input.source_ref ?? null, now, now);
    return this.get(input.id)!;
  }

  get(id: string): PersonalMemory | undefined {
    const row = this.db.prepare('SELECT * FROM personal_memories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  search(options: { query?: string; scope?: PersonalMemoryScope; limit?: number; includeForgotten?: boolean } = {}): PersonalMemory[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (!options.includeForgotten) clauses.push("status = 'active'");
    if (options.scope) { clauses.push('scope = ?'); params.push(options.scope); }
    if (options.query?.trim()) {
      clauses.push('(content LIKE ? OR kind LIKE ?)');
      const query = options.query.trim();
      params.push(`%${query}%`, `%${query}%`);
    }
    params.push(Math.max(1, Math.min(options.limit ?? 20, 100)));
    const rows = this.db.prepare(`SELECT * FROM personal_memories ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ?`)
      .all(...params) as Record<string, unknown>[];
    return rows.map(row => this.hydrate(row));
  }

  forget(id: string): boolean { return this.changeStatus(id, 'forgotten'); }
  restore(id: string): boolean { return this.changeStatus(id, 'active'); }

  private changeStatus(id: string, status: 'active' | 'forgotten'): boolean {
    const change = this.db.transaction(() => {
      const current = this.db.prepare('SELECT * FROM personal_memories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!current || current.status === status) return false;
      const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO personal_memory_versions
        (memory_id, content, scope, kind, sensitivity, source, source_ref, status, changed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(current.id, current.content, current.scope, current.kind, current.sensitivity, current.source, current.source_ref, current.status, now);
      this.db.prepare('UPDATE personal_memories SET status = ?, updated_at = ?, forgotten_at = ? WHERE id = ?')
        .run(status, now, status === 'forgotten' ? now : null, id);
      return true;
    });
    return change();
  }

  private hydrate(row: Record<string, unknown>): PersonalMemory {
    return {
      id: row.id as string,
      content: row.content as string,
      scope: row.scope as PersonalMemoryScope,
      kind: row.kind as string,
      sensitivity: row.sensitivity as PersonalMemorySensitivity,
      source: row.source as string,
      ...(row.source_ref ? { source_ref: row.source_ref as string } : {}),
      status: row.status as PersonalMemory['status'],
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      ...(row.forgotten_at ? { forgotten_at: row.forgotten_at as string } : {}),
    };
  }
}
