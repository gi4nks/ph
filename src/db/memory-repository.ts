import type Database from 'better-sqlite3';
import type { MemoryEntry, ProjectSummary } from '../types.js';

export class MemoryRepository {
  constructor(private readonly db: Database.Database) {}

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

  /** Persist an approved knowledge batch and its aggregate summaries atomically. */
  promoteMemories(memories: Omit<MemoryEntry, 'id'>[]): number[] {
    return this.db.transaction(() => memories.map(memory => {
      const id = this.insertMemory(memory);
      this.upsertProjectSummary({
        project: memory.project,
        summary: memory.summary,
        key_insights: memory.key_insights,
        technical_decisions: memory.technical_decisions,
        git_context_snapshot: memory.git_context_snapshot,
      });
      return id;
    }))();
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

  getLastMemoryForProject(project: string): MemoryEntry | undefined {
    const row = this.db
      .prepare('SELECT * FROM memories WHERE project = ? ORDER BY updated_at DESC LIMIT 1')
      .get(project) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.hydrateMemory(row);
  }

  getAllProjectsWithMemories(): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT project FROM memories ORDER BY project')
      .all() as { project: string }[];
    return rows.map(r => r.project);
  }

  upsertProjectSummary(params: {
    project: string;
    summary: string;
    key_insights: string[];
    technical_decisions: string[];
    git_context_snapshot?: string;
  }): void {
    const existing = this.getProjectSummary(params.project);
    const now = new Date().toISOString();

    if (existing) {
      const allInsights = new Set([...existing.key_insights, ...params.key_insights]);
      const allDecisions = new Set([...existing.technical_decisions, ...params.technical_decisions]);

      this.db.prepare(`
        UPDATE project_summaries
        SET summary = ?,
            key_insights = ?,
            technical_decisions = ?,
            prompt_count = prompt_count + 1,
            last_analyzed = ?,
            git_context_snapshot = COALESCE(?, git_context_snapshot)
        WHERE project = ?
      `).run(
        params.summary,
        JSON.stringify([...allInsights]),
        JSON.stringify([...allDecisions]),
        now,
        params.git_context_snapshot || null,
        params.project
      );
    } else {
      this.db.prepare(`
        INSERT INTO project_summaries (project, summary, key_insights, technical_decisions, prompt_count, first_analyzed, last_analyzed, git_context_snapshot)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?)
      `).run(
        params.project,
        params.summary,
        JSON.stringify(params.key_insights),
        JSON.stringify(params.technical_decisions),
        now,
        now,
        params.git_context_snapshot || null
      );
    }
  }

  getProjectSummary(project: string): ProjectSummary | null {
    const row = this.db.prepare('SELECT * FROM project_summaries WHERE project = ?').get(project) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.hydrateProjectSummary(row);
  }

  getAllProjectsWithSummaries(): string[] {
    const rows = this.db.prepare('SELECT project FROM project_summaries ORDER BY project').all() as { project: string }[];
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

  private hydrateProjectSummary(row: Record<string, unknown>): ProjectSummary {
    return {
      project: row.project as string,
      summary: row.summary as string,
      key_insights: JSON.parse(row.key_insights as string),
      technical_decisions: JSON.parse(row.technical_decisions as string),
      prompt_count: row.prompt_count as number,
      first_analyzed: row.first_analyzed as string,
      last_analyzed: row.last_analyzed as string,
      git_context_snapshot: row.git_context_snapshot as string | undefined,
    };
  }

  getAllMemoriesByProject(project: string): MemoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM memories WHERE project = ? ORDER BY created_at ASC')
      .all(project) as Record<string, unknown>[];
    return rows.map(r => this.hydrateMemory(r));
  }

}
