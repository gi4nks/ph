import path from 'path';
import os from 'os';
import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { importGeminiHistory } from '../importer/gemini.js';
import { importClaudeHistory } from '../importer/claude.js';
import { importOpenCodeHistory } from '../importer/opencode.js';
import { getProvider } from '../ai/provider.js';
import { FilterPipeline } from '../filter/index.js';
import { parseFlags } from './_utils.js';

export async function cmdImport(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  if (args.length === 0) {
    process.stderr.write('Usage: ph import <source> [--dry-run] [--analyze]\n');
    process.stderr.write('Supported sources: gemini, claude, opencode\n');
    process.exit(1);
  }

  const source = args[0];
  const { flags } = parseFlags(args.slice(1));
  const dryRun = Boolean(flags['dry-run']);
  const analyze = Boolean(flags['analyze']);
  const useFilter = Boolean(flags['filter']);
  const homeDir = os.homedir();

  if (dryRun) console.log('Dry run — nothing will be written to the database.');

  let analyzer;
  if (analyze) {
    analyzer = getProvider(cfg);
    if (!analyzer) {
      process.stderr.write('ph: no LLM provider configured. Run: ph config set analyze-provider ollama\n');
      process.exit(1);
    }
    console.log(`Analyzing with ${analyzer.name} during import...`);
  }

  let filter: FilterPipeline | undefined;
  const existingHashes = dryRun ? new Map<string, number>() : db.getAllPromptHashes();

  if (useFilter) {
    filter = new FilterPipeline({
      minLength: cfg.filterMinLength,
      minRelevance: analyze ? (cfg.filterMinRelevance ?? 3) : 0,
      existingHashes,
    });
    console.log(`Filtering enabled (min-length: ${cfg.filterMinLength ?? 15}${analyze ? `, min-relevance: ${cfg.filterMinRelevance ?? 3}` : ''}).`);
  } else {
    filter = new FilterPipeline({
      minLength: 0,
      minRelevance: 0,
      existingHashes,
    });
    filter.checkRules = () => ({ keep: true });
  }

  const onProgress = (evaluated: number, imported: number, total: number, current: string) => {
    const text = current.length > 50 ? current.slice(0, 47) + '...' : current;
    process.stdout.write(`\r  [${evaluated}/${total}] (imported: ${imported}) ${text.replace(/\n/g, ' ')}`.padEnd(80));
  };

  let result;
  switch (source) {
    case 'gemini':
      result = await importGeminiHistory(db, path.join(homeDir, '.gemini'), dryRun, analyzer, onProgress, filter);
      break;
    case 'claude':
      result = await importClaudeHistory(db, path.join(homeDir, '.claude'), dryRun, analyzer, onProgress, filter);
      break;
    case 'opencode':
      result = await importOpenCodeHistory(db, path.join(homeDir, '.local', 'share', 'opencode', 'storage'), dryRun, analyzer, onProgress, filter);
      break;
    default:
      process.stderr.write(`ph: unknown import source "${source}". Supported: gemini, claude, opencode\n`);
      process.exit(1);
  }

  if (analyze) process.stdout.write('\n');
  console.log(`Files scanned:    ${result.filesScanned}`);
  console.log(`Prompts found:    ${result.promptsFound}`);
  console.log(`Prompts imported: ${result.promptsImported}`);
  if (result.filtered > 0) console.log(`Filtered out:     ${result.filtered}`);
  if (analyze) console.log(`Analyzed:         ${result.promptsImported} prompts tagged`);
  if (result.skipped > 0) console.log(`Skipped:          ${result.skipped}`);
  if (result.errors.length > 0) {
    console.log(`\nWarnings (${result.errors.length}):`);
    for (const e of result.errors) console.log(`  - ${e}`);
  }
  if (!dryRun && result.promptsImported > 0) {
    console.log(`\nDone! Run \`ph last ${Math.min(result.promptsImported, 20)}\` to review.`);
  }
}
