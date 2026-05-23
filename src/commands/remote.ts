import { createHash } from 'crypto';
import { PhDB, defaultPath } from '../db/index.js';
import { load as loadConfig, save as saveConfig } from '../config/index.js';

function remoteUrl(cfg: Record<string, any>): string {
  return process.env.PH_REMOTE_URL || cfg.remoteUrl || '';
}

export async function cmdRemote(dbPath: string, args: string[]): Promise<void> {
  const cfg = loadConfig();
  const url = remoteUrl(cfg);
  if (!url) {
    process.stderr.write('ph: remote not configured. Set PH_REMOTE_URL env or: ph config set remoteUrl <url>\n');
    process.exit(1);
  }

  const sub = args[0];
  switch (sub) {
    case 'push':
      await push(dbPath, cfg, url);
      break;
    case 'pull':
      await pull(dbPath, cfg, url);
      break;
    case 'status':
      await status(dbPath, cfg, url);
      break;
    default:
      process.stdout.write(`ph remote commands:
  push               Push new local prompts to remote
  pull               Pull remote prompts and merge into local
  status             Show sync status

Remote: ${url}\n`);
  }
}

async function push(dbPath: string, cfg: Record<string, any>, url: string): Promise<void> {
  const db = new PhDB(dbPath);
  const since = cfg.remoteLastPush || '1970-01-01T00:00:00.000Z';
  const prompts = db.getPromptsSince(since, 5000);

  if (prompts.length === 0) {
    process.stdout.write('Nothing to push.\n');
    db.close();
    return;
  }

  process.stdout.write(`Pushing ${prompts.length} prompts to ${url}...\n`);

  try {
    const res = await fetch(`${url}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.remoteApiKey ? { Authorization: `Bearer ${cfg.remoteApiKey}` } : {}),
      },
      body: JSON.stringify({ prompts }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Remote error ${res.status}: ${err}`);
    }

    const result = await res.json() as { imported: number; skipped: number; errors: string[] };
    process.stdout.write(`Imported: ${result.imported}, Skipped: ${result.skipped}\n`);
    if (result.errors.length > 0) {
      result.errors.forEach(e => process.stderr.write(`  Error: ${e}\n`));
    }

    const maxTs = prompts.reduce((max, p) => p.timestamp > max ? p.timestamp : max, '');
    cfg.remoteLastPush = maxTs;
    saveConfig(cfg);
    process.stdout.write(`Push timestamp saved.\n`);
  } catch (err) {
    process.stderr.write(`ph: push failed: ${(err as Error).message}\n`);
    process.exit(1);
  } finally {
    db.close();
  }
}

async function pull(dbPath: string, cfg: Record<string, any>, url: string): Promise<void> {
  const db = new PhDB(dbPath);
  const since = cfg.remoteLastPull || '';

  process.stdout.write(`Pulling from ${url}${since ? ` (since ${since})` : ''}...\n`);

  try {
    const res = await fetch(`${url}/api/sync/pull`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.remoteApiKey ? { Authorization: `Bearer ${cfg.remoteApiKey}` } : {}),
      },
      body: JSON.stringify({ since: since || undefined }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Remote error ${res.status}: ${err}`);
    }

    const result = await res.json() as { prompts: any[]; hasMore: boolean };
    if (result.prompts.length === 0) {
      process.stdout.write('No new prompts on remote.\n');
      db.close();
      return;
    }

    let imported = 0;
    let skipped = 0;
    for (const p of result.prompts) {
      const hash = sha256(`${p.tool}|${p.prompt}|${p.response}`);
      const existing = db.getPromptBySyncHash(hash);
      if (existing) { skipped++; continue; }

      const metaObj = { ...JSON.parse(p.metadata || '{}'), sync_hash: hash };
      db.insert({
        timestamp: p.timestamp || new Date().toISOString(),
        tool: p.tool || 'unknown',
        prompt: p.prompt || '',
        response: p.response || '',
        args: p.args || '',
        workdir: p.workdir || '',
        hostname: p.hostname || '',
        exit_code: p.exit_code ?? 0,
        metadata: JSON.stringify(metaObj),
      });
      imported++;
    }

    process.stdout.write(`Imported: ${imported}, Skipped (already local): ${skipped}\n`);

    const maxTs = result.prompts.reduce((max: string, p: any) => p.timestamp > max ? p.timestamp : max, '');
    cfg.remoteLastPull = maxTs;
    saveConfig(cfg);
  } catch (err) {
    process.stderr.write(`ph: pull failed: ${(err as Error).message}\n`);
    process.exit(1);
  } finally {
    db.close();
  }
}

async function status(dbPath: string, cfg: Record<string, any>, url: string): Promise<void> {
  const db = new PhDB(dbPath);

  const localTotal = db.getPromptCount();
  const lastPush = cfg.remoteLastPush || 'never';
  const lastPull = cfg.remoteLastPull || 'never';

  const pending = cfg.remoteLastPush
    ? (db.db.prepare('SELECT count(*) as c FROM prompts WHERE timestamp > ?').get(cfg.remoteLastPush) as { c: number }).c
    : localTotal;

  process.stdout.write(`Remote:      ${url}\n`);
  process.stdout.write(`Local total: ${localTotal} prompts\n`);
  process.stdout.write(`Last push:   ${lastPush}\n`);
  process.stdout.write(`Last pull:   ${lastPull}\n`);
  process.stdout.write(`Pending:     ${pending} prompts to push\n`);
  db.close();
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
