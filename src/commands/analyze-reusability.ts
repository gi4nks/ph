import fs from 'fs';
import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { ReusabilityAnalyzer } from '../analyzer/reusability.js';
import { parseFlags } from './_utils.js';

export async function cmdAnalyzeReusability(db: PhDB, _cfg: PhConfig, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const threshold = flags['threshold'] ? Number(flags['threshold']) : 0.7;
  const exportCsv = flags['export-csv'] as string;

  const entries = db.getAllPrompts();
  const embeddings = db.getAllEmbeddings();

  if (embeddings.size === 0) {
    console.warn('ph: no embeddings found. Uniqueness score will be 1.0 for all. Run `ph embed-all` first.');
  }

  console.log(`Scanning ${entries.length} prompts...`);
  const analyzer = new ReusabilityAnalyzer(threshold);
  const report = analyzer.analyze(entries, embeddings);

  const C = {
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    gray: '\x1b[90m',
    bold: '\x1b[1m',
  };

  console.log(`\n${C.bold}SUMMARY:${C.reset}`);
  console.log(`  - ${C.green}KEEP${C.reset} (score 7+):     ${C.yellow}${report.keep.length}${C.reset} prompts (${((report.keep.length / report.total) * 100).toFixed(1)}%)`);
  console.log(`  - ${C.cyan}REVIEW${C.reset} (score 4-7):   ${C.yellow}${report.review.length}${C.reset} prompts (${((report.review.length / report.total) * 100).toFixed(1)}%)`);
  console.log(`  - ${C.red}REMOVE${C.reset} (score <4):   ${C.yellow}${report.remove.length}${C.reset} prompts (${((report.remove.length / report.total) * 100).toFixed(1)}%)`);

  console.log(`\n${C.bold}BY ROLE:${C.reset}`);
  const roles = Object.keys(report.byRole).sort();
  for (const role of roles) {
    const r = report.byRole[role];
    const roleStr = role.padEnd(12);
    console.log(`  ${C.gray}${roleStr}${C.reset} | KEEP: ${C.green}${r.keep.toString().padEnd(4)}${C.reset} REVIEW: ${C.cyan}${r.review.toString().padEnd(4)}${C.reset} REMOVE: ${C.red}${r.remove.toString().padEnd(4)}${C.reset}`);
  }

  console.log(`\n${C.bold}DUPLICATES FOUND:${C.reset}`);
  console.log(`  - Exact semantic (sim > 0.95): ${C.yellow}${report.duplicates.exact}${C.reset} prompts`);
  console.log(`  - Variant clusters (sim 0.85-0.95): ${C.yellow}${report.duplicates.variants}${C.reset} prompts`);

  console.log(`\n${C.bold}TOP 10 KEEP (unique + high score):${C.reset}`);
  report.keep.slice(0, 10).forEach(s => {
    const scoreStr = s.score.toFixed(1).padStart(4);
    console.log(`  [${C.green}${scoreStr}${C.reset}] ${s.prompt.replace(/\n/g, ' ').slice(0, 80)}...`);
  });

  console.log(`\n${C.bold}TOP 10 REMOVE (low score + duplicate):${C.reset}`);
  report.remove.slice(0, 10).forEach(s => {
    const scoreStr = s.score.toFixed(1).padStart(4);
    console.log(`  [${C.red}${scoreStr}${C.reset}] ${s.prompt.replace(/\n/g, ' ').slice(0, 80)}...`);
  });

  if (exportCsv) {
    fs.writeFileSync(exportCsv, analyzer.toCSV(report));
    console.log(`\n${C.green}✅ Report exported to ${exportCsv}${C.reset}`);
  }
  console.log();
}
