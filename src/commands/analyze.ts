import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { getProvider } from '../ai/provider.js';
import { analyzeAll } from '../analyzer/index.js';
import { parseFlags } from './_utils.js';

export async function cmdAnalyze(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const force = Boolean(flags['force']);
  const dryRun = Boolean(flags['dry-run']);
  const prune = Boolean(flags['prune']);
  const limitFlag = flags['limit'] ? Number(flags['limit']) : undefined;
  const pruneBelow = prune ? (flags['min-score'] ? Number(flags['min-score']) : (cfg.filterMinRelevance ?? 3)) : 0;

  const provider = getProvider(cfg);
  if (!provider) {
    process.stderr.write('ph: no LLM provider configured. Set analyze-provider in config.\n');
    process.exit(1);
  }

  const allRows = db.search({ limit: 10000 });
  const limit = limitFlag ?? (force ? undefined : 50);
  const entries = limit !== undefined ? allRows.slice(0, limit) : allRows;

  let modeStr = force ? ' (--force: reanalyze all)' : ' (untagged only)';
  if (prune) modeStr += dryRun ? ` + prune<${pruneBelow} [dry-run]` : ` + prune<${pruneBelow}`;
  console.log(`Analyzing with ${provider.name}${modeStr}...`);

  const stats = await analyzeAll(entries, provider, db, {
    force,
    pruneBelow,
    dryRun,
    onProgress: (done, total, entry, res, err) => {
      const truncated = entry.prompt.replace(/\n/g, ' ');
      const short = truncated.length > 40 ? truncated.slice(0, 37) + '...' : truncated;
      if (err) {
        console.log(`  [${done}/${total}] #${entry.id} → error: ${err}`);
      } else if (res) {
        const role = res.role || '-';
        const tags = (res.tags ?? []).join(',') || '-';
        const relStr = res.relevance !== undefined ? ` rel:${res.relevance}` : '';
        console.log(`  [${done}/${total}] #${entry.id} → role:${role} tags:${tags}${relStr} | ${short}`);
      }
    },
    onPrune: (entry, relevance) => {
      const short = entry.prompt.replace(/\n/g, ' ').slice(0, 50);
      console.log(`  [prune${dryRun ? ' DRY' : ''}] #${entry.id} rel:${relevance} | ${short}`);
    },
  });

  let summary = `\nDone. Updated: ${stats.updated}, Skipped: ${stats.skipped}, Failed: ${stats.failed}`;
  if (prune) summary += `, Pruned: ${stats.pruned}${dryRun ? ' (dry-run, not deleted)' : ''}`;
  console.log(summary);
}
