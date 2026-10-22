import type Database from 'better-sqlite3';

export class ArchiveRepository {
  constructor(private readonly db: Database.Database) {}

  archivePrompts(ids: number[]): number {
    if (ids.length === 0) return 0;
    const now = new Date().toISOString();
    const select = this.db.prepare(`
      SELECT id, timestamp, tool, prompt, response, args, workdir, hostname, exit_code, metadata
      FROM prompts WHERE id = ?
    `);
    const insert = this.db.prepare(`
      INSERT INTO prompts_archive (timestamp, tool, prompt, response, args, workdir, hostname, exit_code, metadata, archived_at, original_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const del = this.db.prepare('DELETE FROM prompts WHERE id = ?');

    const transaction = this.db.transaction((toArchive: number[]) => {
      let count = 0;
      for (const id of toArchive) {
        const row = select.get(id) as Record<string, unknown> | undefined;
        if (!row) continue;
        insert.run(
          row.timestamp, row.tool, row.prompt, row.response, row.args,
          row.workdir, row.hostname, row.exit_code, row.metadata,
          now, id
        );
        del.run(id);
        count++;
      }
      return count;
    });

    return transaction(ids);
  }

  searchArchive(opts: { since?: string; until?: string; limit?: number }): Array<Record<string, unknown>> {
    let sql = 'SELECT * FROM prompts_archive WHERE 1=1';
    const params: unknown[] = [];
    if (opts.since) { sql += ' AND timestamp >= ?'; params.push(opts.since); }
    if (opts.until) { sql += ' AND timestamp <= ?'; params.push(opts.until); }
    sql += ' ORDER BY timestamp DESC';
    if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    return this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  }

  purgeArchive(beforeDate: string): number {
    const result = this.db.prepare('DELETE FROM prompts_archive WHERE archived_at < ?').run(beforeDate);
    return result.changes;
  }

  getArchiveStats(): { total: number; oldest: string | null; newest: string | null } {
    const row = this.db.prepare(`
      SELECT COUNT(*) as total, MIN(timestamp) as oldest, MAX(timestamp) as newest
      FROM prompts_archive
    `).get() as { total: number; oldest: string | null; newest: string | null };
    return row;
  }

}
