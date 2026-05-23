import fs from 'fs';
import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { ReusabilityAnalyzer } from '../analyzer/reusability.js';
import { parseFlags } from './_utils.js';

export async function cmdCleanupReusability(db: PhDB, _cfg: PhConfig, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const threshold = flags['threshold'] ? parseFloat(flags['threshold'] as string) : 0.7;
  const dryRun = Boolean(flags['dry-run']);
  const force = Boolean(flags['force']);

  const entries = db.getAllPrompts();
  const embeddings = db.getAllEmbeddings();

  const analyzer = new ReusabilityAnalyzer(threshold);
  const candidates = analyzer.getRemovalCandidates(entries, embeddings, threshold);

  if (candidates.length === 0) {
    console.log('ph: no prompts match removal criteria');
    return;
  }

  const totalSize = candidates.reduce((sum, c) => sum + c.promptSize + c.responseSize, 0);
  const totalEmbeddingSize = candidates.filter(c => c.hasEmbedding).length * 768 * 4;
  const totalToFree = totalSize + totalEmbeddingSize;

  const C = {
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    gray: '\x1b[90m',
    bold: '\x1b[1m',
  };

  const removeThreshold = Math.max(0, threshold - 0.3) * 10;
  const dbCount = entries.length;

  console.log(`\nWould delete ${C.red}${candidates.length}${C.reset} prompts (${((candidates.length / dbCount) * 100).toFixed(1)}% of database):`);
  console.log(`  - By score < ${removeThreshold.toFixed(1)}: ${candidates.length} prompts`);

  const byRole: Record<string, number> = {};
  for (const c of candidates) {
    byRole[c.role] = (byRole[c.role] ?? 0) + 1;
  }
  const roleSummary = Object.entries(byRole)
    .sort((a, b) => b[1] - a[1])
    .map(([role, count]) => `${role} (${count})`)
    .join(', ');

  console.log(`  - By role (mostly): ${roleSummary}`);

  console.log(`\nStorage impact:`);
  console.log(`  - Prompt text:   ~${(candidates.reduce((sum, c) => sum + c.promptSize, 0) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  - Response text: ~${(candidates.reduce((sum, c) => sum + c.responseSize, 0) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  - Embeddings:    ~${(totalEmbeddingSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Total to free:   ~${(totalToFree / 1024 / 1024).toFixed(2)} MB`);

  if (candidates.length > 0) {
    console.log(`\n${C.bold}Example candidates (top 20):${C.reset}`);
    candidates.slice(0, 20).forEach(c => {
      const entry = entries.find(e => e.id === c.id);
      if (entry) {
        const preview = entry.prompt.replace(/\n/g, ' ').slice(0, 80);
        console.log(`  [${C.red}${c.score.toFixed(1)}${C.reset}] #${entry.id} ${preview}...`);
      }
    });
  }

  if (dryRun) {
    console.log(`\nRun with ${C.bold}--force${C.reset} or without ${C.bold}--dry-run${C.reset} to proceed.`);
    return;
  }

  if (!force) {
    process.stdout.write(`\nContinue and delete ${candidates.length} prompts? (y/N) `);
    const buffer = Buffer.alloc(16);
    const bytesRead = fs.readSync(0, buffer, 0, 16);
    const answer = buffer.toString('utf8', 0, bytesRead).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Aborted.');
      return;
    }
  }

  let deleted = 0;
  for (const candidate of candidates) {
    db.delete(candidate.id);
    deleted++;
  }

  console.log(`\nDeleted ${deleted} prompts, freed ~${(totalToFree / 1024 / 1024).toFixed(1)} MB`);
  db.vacuum();
  console.log('Database vacuumed.');
}
