#!/usr/bin/env node

import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import React from 'react';
import { render } from 'ink';
import { load as loadConfig, save as saveConfig } from './config/index.js';
import { PhDB, defaultPath, cosineSimilarity } from './db/index.js';
import { runInline, resolveRealBinary } from './runner/inline.js';
import { detectProject, detectLanguage } from './runner/project.js';
import { captureGitContext } from './runner/git-context.js';
import { runPTY, isTerminal } from './pty/wrapper.js';
import { printResults } from './display/print.js';
import { importGeminiHistory } from './importer/gemini.js';
import { importClaudeHistory } from './importer/claude.js';
import { getEmbeddings } from './embedding/index.js';
import { getProvider } from './ai/provider.js';
import { analyzeAll, analyzePrompt, mergeMetadata } from './analyzer/index.js';
import { ReusabilityAnalyzer } from './analyzer/reusability.js';
import { spawnBackgroundAnalysis } from './background/analyzer.js';
import { FilterPipeline } from './filter/index.js';
import { BrowseApp } from './ui/BrowseApp.js';
import { groupIntoSessions, computeSessionCohesion } from './sessions/index.js';
import { getStats } from './stats/index.js';
import { kmeans } from './cluster/index.js';
import { extractTopic } from './utils/extractTopic.js';
import type { SearchOptions, PromptMetadata } from './types.js';
import type { PhConfig } from './config/index.js';

const USAGE = `ph — prompt history tracker

USAGE:
  ph                                    Open interactive TUI browser (default)
  ph <tool> [tool-args...]              Wrap a CLI tool, save prompt to history
  ph search [options] [query]           Search saved prompts
  ph last [n]                           Show last N prompts (default 10)
  ph sessions [options]                 Group prompts into work sessions
  ph stats                              Show history statistics
  ph cluster [options]                  Cluster prompts by similarity
  ph analyze-reusability [options]      Analyze prompt reusability
  ph star <id>                          Toggle star on a prompt
  ph export <id> [--format txt|json|md] Export a single prompt
  ph import gemini [--dry-run] [--analyze] [--filter]  Import from Gemini CLI sessions
  ph import claude [--dry-run] [--analyze] [--filter]  Import from Claude CLI sessions
  ph analyze [--limit n] [--force] [--prune] [--dry-run]  Analyze prompts with LLM
  ph cleanup [--dry-run] [--min-length N] [--min-score N]  Remove useless prompts
  ph cleanup-reusability [--dry-run] [--threshold 0.7] [--force]  Cleanup based on reusability
  ph embed-all                          Generate embeddings for all prompts
  ph log --tool <name> --prompt <text> [--response <text>]  Log a prompt+response directly
  ph config set <key> <value>           Save config value
  ph browse                             Interactive TUI browser

WRAP FLAGS (placed before the tool name):
  --ph-tag <tag>                        Add a tag to the captured prompt
  --ph-role <role>                      Set the prompt role (debug, refactor, explain, review, architect, test, docs, generate, research)
  --ph-debug                            Write a debug log to ~/.ph_debug.log

SEARCH OPTIONS:
  -i, --interactive   Open results in interactive TUI browser
  --tool <name>       Filter by tool name (claude, gemini, …)
  --project <name>    Filter by project name
  --language <lang>   Filter by language (go, typescript, python, …)
  --role <role>       Filter by role (debug, refactor, explain, …)
  --tag <tag>         Filter by tag
  --starred           Show only starred prompts
  --min-quality <n>   Filter by min quality (0-10)
  --min-relevance <n> Filter by min relevance (0-10)
  --top               Show only top quality prompts (quality >= 8)
  --semantic          Use semantic search (requires embeddings)
  --since YYYY-MM-DD
  --until YYYY-MM-DD
  --limit <n>         Max results (default 50)
  --full              Show full prompt without truncation

SESSIONS OPTIONS:
  --gap-hours <n>     Hours gap to split sessions (default 2)
  --limit <n>         Max sessions to show (default 20)
  --min-size <n>      Minimum prompts per session (default 1)
  --no-cohesion       Skip semantic cohesion computation

CLUSTER OPTIONS:
  -k <number>         Number of clusters (default 5)
  --limit <n>         Max prompts per cluster to show (default 3)

ANALYZE-REUSABILITY OPTIONS:
  --export-csv <file>  Export report to CSV
  --threshold <n>      Scoring threshold (default 0.7)

EXAMPLES:
  ph claude "explain goroutines"
  ph --ph-role debug --ph-tag auth claude "fix JWT expiration bug"
  ph search "goroutines"
  ph search --tool claude --role debug --since 2026-01-01 "error handling"
  ph search --semantic "how to handle errors gracefully"
  ph search -i "database"
  ph last 20
  ph sessions
  ph sessions --gap-hours 4 --min-size 3
  ph stats
  ph cluster -k 10
  ph export 5 --format md
  ph import claude --analyze --filter
  ph analyze --force --prune --min-score 3
  ph cleanup --dry-run
  ph embed-all
  ph analyze-reusability --export-csv report.csv
  ph cleanup-reusability --dry-run
  ph config set analyze-provider gemini
  ph config set background-analysis true
  ph config set ollama-model llama3.2:latest
  ph ollama-models                          List models available on the local Ollama instance
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseFlags(args: string[]): { flags: Record<string, string | boolean>; positional: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[i + 1];
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else {
      positional.push(a);
      i++;
    }
  }
  return { flags, positional };
}

function parseDate(s: string, label: string): Date {
  const d = new Date(s);
  if (isNaN(d.getTime())) {
    process.stderr.write(`ph: invalid ${label} date: ${s}\n`);
    process.exit(1);
  }
  return d;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdSearch(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);

  const query = positional.join(' ');

  if (flags['semantic'] && query) {
    await cmdSearchSemantic(db, cfg, query, Number(flags['limit'] ?? 50), Boolean(flags['full']));
    return;
  }

  const opts: SearchOptions = {
    query,
    tool: flags['tool'] as string | undefined,
    project: flags['project'] as string | undefined,
    language: flags['language'] as string | undefined,
    role: flags['role'] as string | undefined,
    tag: flags['tag'] as string | undefined,
    starred: Boolean(flags['starred']),
    minQuality: flags['top'] ? 8 : (flags['min-quality'] ? Number(flags['min-quality']) : undefined),
    minRelevance: flags['min-relevance'] ? Number(flags['min-relevance']) : undefined,
    limit: Number(flags['limit'] ?? 50),
  };

  if (flags['since']) opts.since = parseDate(flags['since'] as string, '--since');
  if (flags['until']) {
    const d = parseDate(flags['until'] as string, '--until');
    // Include the full day
    d.setHours(23, 59, 59, 999);
    opts.until = d;
  }

  const results = db.search(opts);
  printResults(results, Boolean(flags['full']));
}

async function cmdSearchSemantic(db: PhDB, cfg: PhConfig, query: string, limit: number, showFull: boolean): Promise<void> {
  const ollamaUrl = cfg.ollamaUrl ?? 'http://localhost:11434';
  const model = cfg.ollamaEmbedModel ?? 'nomic-embed-text-v2-moe';

  process.stdout.write(`Searching semantically for: "${query}" (model: ${model})...\n`);

  const [queryVec] = await getEmbeddings([query], ollamaUrl, model, 1);
  if (!queryVec) {
    process.stderr.write('ph: failed to get embedding for query\n');
    process.exit(1);
  }

  const embeddings = db.getAllEmbeddings();
  const scores: Array<{ id: number; sim: number }> = [];

  for (const [id, vec] of embeddings) {
    const sim = cosineSimilarity(queryVec, vec);
    if (sim > 0.3) scores.push({ id, sim });
  }

  scores.sort((a, b) => b.sim - a.sim);
  const topScores = scores.slice(0, limit);

  const results = topScores
    .map(({ id }) => db.getById(id))
    .filter((e): e is NonNullable<typeof e> => e !== undefined);

  printResults(results, showFull);
}

async function cmdLast(db: PhDB, args: string[]): Promise<void> {
  const n = parseInt(args[0] ?? '10', 10);
  const results = db.search({ limit: isNaN(n) ? 10 : n });
  printResults(results, false);
}

async function cmdStar(db: PhDB, args: string[]): Promise<void> {
  const id = parseInt(args[0] ?? '', 10);
  if (isNaN(id)) {
    process.stderr.write('Usage: ph star <id>\n');
    process.exit(1);
  }

  const entry = db.getById(id);
  if (!entry) {
    process.stderr.write(`ph: prompt #${id} not found\n`);
    process.exit(1);
  }

  let meta: PromptMetadata = {};
  try { meta = JSON.parse(entry.metadata) as PromptMetadata; } catch {}

  const wasStarred = Boolean(meta.starred);
  meta.starred = !wasStarred;

  db.updateMetadata(id, JSON.stringify(meta));

  if (meta.starred) {
    console.log(`Prompt #${id} starred ★`);
  } else {
    console.log(`Prompt #${id} unstarred`);
  }
}

async function cmdExport(db: PhDB, args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const id = parseInt(positional[0] ?? '', 10);

  if (isNaN(id)) {
    process.stderr.write('Usage: ph export <id> [--format txt|json|md]\n');
    process.exit(1);
  }

  const entry = db.getById(id);
  if (!entry) {
    process.stderr.write(`ph: prompt #${id} not found\n`);
    process.exit(1);
  }

  const format = (flags['format'] as string) ?? 'txt';

  switch (format) {
    case 'txt':
    case 'text':
      process.stdout.write(entry.prompt);
      break;

    case 'json': {
      const obj = {
        id: entry.id,
        timestamp: entry.timestamp,
        tool: entry.tool,
        prompt: entry.prompt,
        metadata: JSON.parse(entry.metadata) as unknown,
      };
      console.log(JSON.stringify(obj));
      break;
    }

    case 'md':
    case 'markdown': {
      let meta: PromptMetadata = {};
      try { meta = JSON.parse(entry.metadata) as PromptMetadata; } catch {}

      let md = `# Prompt #${entry.id}\n\n`;
      if (meta.starred) md += '★ **Starred**\n\n';
      md += `- **Tool**: ${entry.tool}\n`;
      md += `- **Date**: ${entry.timestamp}\n`;
      if (meta.project) md += `- **Project**: ${meta.project}\n`;
      if (meta.language) md += `- **Language**: ${meta.language}\n`;
      if (meta.role) md += `- **Role**: ${meta.role}\n`;
      if (meta.tags && meta.tags.length > 0) md += `- **Tags**: ${meta.tags.join(', ')}\n`;
      md += `- **Dir**: ${entry.workdir}\n\n---\n\n## Prompt\n\n${entry.prompt}\n`;

      if (entry.response) {
        md += `\n## Response\n\n${entry.response}\n`;
      }

      if (meta.git_context) {
        md += `\n## Git Context\n\n`;
        md += `**Branch**: ${meta.git_context.branch}\n`;
        if (meta.git_context.files.length > 0) {
          md += `**Modified files**: ${meta.git_context.files.join(', ')}\n`;
        }
        md += `\n\`\`\`diff\n${meta.git_context.diff}\n\`\`\`\n`;
      }

      process.stdout.write(md);
      break;
    }

    default:
      process.stderr.write(`ph: unknown format "${format}" — use txt, json, or md\n`);
      process.exit(1);
  }
}

async function cmdImport(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  if (args.length === 0) {
    process.stderr.write('Usage: ph import <source> [--dry-run] [--analyze]\n');
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
  
  // Always load existing hashes for deduplication unless we are doing a dry-run
  const existingHashes = dryRun ? new Map<string, number>() : db.getAllPromptHashes();
  
  if (useFilter) {
    filter = new FilterPipeline({
      minLength: cfg.filterMinLength,
      minRelevance: analyze ? (cfg.filterMinRelevance ?? 3) : 0,
      existingHashes,
    });
    console.log(`Filtering enabled (min-length: ${cfg.filterMinLength ?? 15}${analyze ? `, min-relevance: ${cfg.filterMinRelevance ?? 3}` : ''}).`);
  } else {
    // If not full filtering, we still create a minimal FilterPipeline just for exact duplication checks
    filter = new FilterPipeline({
      minLength: 0,
      minRelevance: 0,
      existingHashes,
    });
    // We mock checkRules so it only dedups, effectively bypassing the length/trivial rules
    filter.checkRules = () => ({ keep: true });
  }

  const onProgress = (evaluated: number, imported: number, total: number, current: string) => {
    const text = current.length > 50 ? current.slice(0, 47) + '...' : current;
    // Show [evaluated/total] (imported) so user knows progress
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
    default:
      process.stderr.write(`ph: unknown import source "${source}". Supported: gemini, claude\n`);
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

async function cmdAnalyze(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
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

async function cmdEmbedAll(db: PhDB, cfg: PhConfig): Promise<void> {
  const ollamaUrl = cfg.ollamaUrl ?? 'http://localhost:11434';
  const model = cfg.ollamaEmbedModel ?? 'nomic-embed-text-v2-moe';

  const toEmbed = db.getPromptsWithoutEmbeddings();

  if (toEmbed.length === 0) {
    console.log('No new prompts to embed.');
    return;
  }

  const batchSize = 20;
  console.log(
    `Generating embeddings for ${toEmbed.length} prompts via Ollama (${model}), batches of ${batchSize}...`
  );

  for (let i = 0; i < toEmbed.length; i += batchSize) {
    const batch = toEmbed.slice(i, i + batchSize);
    const texts = batch.map((e) => e.response ? `${e.prompt}\n\n${e.response}` : e.prompt);
    process.stdout.write(`\r→ ${i + batch.length}/${toEmbed.length}...`);

    try {
      const vecs = await getEmbeddings(texts, ollamaUrl, model, batchSize);
      for (let j = 0; j < vecs.length; j++) {
        try {
          db.saveEmbedding(batch[j].id, vecs[j]);
        } catch (e: unknown) {
          console.log(`\n  ! DB error for #${batch[j].id}: ${(e as Error).message}`);
        }
      }
    } catch (e: unknown) {
      console.log(`\n  ! Batch error: ${(e as Error).message}`);
    }
  }

  console.log('\nDone!');
}

async function cmdLog(dbPath: string, cfg: PhConfig, args: string[]): Promise<void> {
  // Support two modes:
  // 1. Flags: ph log --tool claude --prompt "..." --response "..."
  // 2. Stdin JSON: echo '{"tool":"claude","prompt":"...","response":"..."}' | ph log
  let tool: string;
  let prompt: string;
  let response: string;
  let workdir: string;

  const { flags } = parseFlags(args);

  if (flags['prompt']) {
    tool     = (flags['tool']     as string) || 'unknown';
    prompt   = (flags['prompt']   as string);
    response = (flags['response'] as string) || '';
    workdir  = (flags['workdir']  as string) || process.cwd();
  } else {
    // Read JSON from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    if (!raw) { process.stderr.write('ph log: no input (use --prompt or pipe JSON)\n'); process.exit(1); }
    let parsed: Record<string, string>;
    try { parsed = JSON.parse(raw) as Record<string, string>; }
    catch { process.stderr.write('ph log: invalid JSON on stdin\n'); process.exit(1); }
    tool     = parsed['tool']     || (flags['tool']    as string) || 'unknown';
    prompt   = parsed['prompt']   || '';
    response = parsed['response'] || '';
    workdir  = parsed['workdir']  || (flags['workdir'] as string) || process.cwd();
    if (!prompt) { process.stderr.write('ph log: missing "prompt" field\n'); process.exit(1); }
  }

  const { rootDir, projectName } = detectProject(workdir);
  const language = detectLanguage(rootDir);

  const metaObj: Record<string, unknown> = {};
  if (projectName) metaObj.project = projectName;
  if (language)    metaObj.language = language;

  const title = extractTopic(prompt);
  if (title) metaObj.title = title;

  const db = new PhDB(dbPath);
  const id = db.insert({
    timestamp: new Date().toISOString(),
    tool,
    prompt,
    response,
    args: '',
    workdir,
    hostname: os.hostname(),
    exit_code: 0,
    metadata: JSON.stringify(metaObj),
  });
  db.close();

  if (cfg.backgroundAnalysis) {
    spawnBackgroundAnalysis(id, dbPath);
  }
}

function cmdConfig(args: string[]): void {
  if (args.length < 3 || args[0] !== 'set') {
    console.log('Usage: ph config set <key> <value>');
    console.log('Keys: gemini-api-key, db-path, analyze-provider, ollama-url, ollama-model,');
    console.log('      ollama-embed-model, filter-min-length, filter-min-relevance, background-analysis');
    process.exit(1);
  }

  const cfg = loadConfig();
  const key = args[1];
  const val = args[2];

  switch (key) {
    case 'gemini-api-key':
      cfg.geminiApiKey = val;
      break;
    case 'db-path':
      cfg.dbPath = val;
      break;
    case 'analyze-provider':
      if (val !== 'ollama' && val !== 'gemini') {
        process.stderr.write('ph: analyze-provider must be "ollama" or "gemini"\n');
        process.exit(1);
      }
      cfg.analyzeProvider = val as 'ollama' | 'gemini';
      break;
    case 'ollama-url':
      cfg.ollamaUrl = val;
      break;
    case 'ollama-model':
      cfg.ollamaModel = val;
      break;
    case 'ollama-embed-model':
      cfg.ollamaEmbedModel = val;
      break;
    case 'filter-min-length': {
      const n = Number(val);
      if (isNaN(n) || n < 0) { process.stderr.write('ph: filter-min-length must be a non-negative integer\n'); process.exit(1); }
      cfg.filterMinLength = n;
      break;
    }
    case 'filter-min-relevance': {
      const n = Number(val);
      if (isNaN(n) || n < 0 || n > 10) { process.stderr.write('ph: filter-min-relevance must be 0-10\n'); process.exit(1); }
      cfg.filterMinRelevance = n;
      break;
    }
    case 'background-analysis':
      cfg.backgroundAnalysis = val === 'true' || val === '1';
      break;
    default:
      process.stderr.write(`ph: unknown config key "${key}"\n`);
      process.exit(1);
  }

  saveConfig(cfg);
  console.log(`Config "${key}" updated successfully.`);
}

async function cmdBackgroundAnalyze(dbPath: string, args: string[]): Promise<void> {
  const id = parseInt(args[0], 10);
  if (isNaN(id)) return;

  let finalDbPath = dbPath;
  const dbIdx = args.indexOf('--db');
  if (dbIdx !== -1 && dbIdx + 1 < args.length) {
    finalDbPath = args[dbIdx + 1];
  }

  const cfg = loadConfig();
  const provider = getProvider(cfg);
  if (!provider) return;

  const db = new PhDB(finalDbPath);
  try {
    const entry = db.getById(id);
    if (!entry) return;

    const result = await analyzePrompt(entry.prompt, provider);
    if (Object.keys(result).length === 0) return;

    let existing: PromptMetadata = {};
    try { existing = JSON.parse(entry.metadata) as PromptMetadata; } catch {}

    const merged = mergeMetadata(existing, result, false);
    db.updateMetadata(id, JSON.stringify(merged));
  } catch (_err: unknown) {
    // Silent fail for background process
  } finally {
    db.close();
  }
}

async function cmdCleanup(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const dryRun = Boolean(flags['dry-run']);
  const minLength = flags['min-length'] ? Number(flags['min-length']) : (cfg.filterMinLength ?? 15);
  const minScore = flags['min-score'] ? Number(flags['min-score']) : (cfg.filterMinRelevance ?? 3);
  const days = flags['days'] ? Number(flags['days']) : undefined;

  if (days !== undefined) {
    if (dryRun) {
      console.log(`(dry-run) Would delete prompts older than ${days} days.`);
    } else {
      const deleted = db.deleteOlderThan(days);
      console.log(`Deleted ${deleted} prompts older than ${days} days.`);
    }
  }

  const allEntries = db.search({ limit: 100000 });
  console.log(`Scanning ${allEntries.length} prompts for rule-based cleanup (min-length: ${minLength}, min-score: ${minScore})...`);

  const toDelete: Array<{ id: number; prompt: string; reason: string }> = [];
  const existingHashes = new Map<string, number>();

  const filter = new FilterPipeline({ minLength, minRelevance: 0, existingHashes });

  for (const entry of allEntries) {
    // Rule-based check
    const ruleResult = filter.checkRules(entry.prompt);
    if (!ruleResult.keep) {
      toDelete.push({ id: entry.id, prompt: entry.prompt, reason: `${ruleResult.reason}: ${ruleResult.details ?? ''}` });
      continue;
    }

    // Exact dedup check
    const hash = FilterPipeline.hashPrompt(entry.prompt);
    if (existingHashes.has(hash)) {
      const dupId = existingHashes.get(hash);
      toDelete.push({ id: entry.id, prompt: entry.prompt, reason: `exact_duplicate of #${dupId}` });
      continue;
    }
    existingHashes.set(hash, entry.id);

    // Relevance score check (only for already-analyzed prompts)
    if (minScore > 0) {
      let meta: PromptMetadata = {};
      try { meta = JSON.parse(entry.metadata) as PromptMetadata; } catch {}
      if (meta.relevance !== undefined && meta.relevance < minScore) {
        toDelete.push({ id: entry.id, prompt: entry.prompt, reason: `low_relevance: ${meta.relevance} < ${minScore}` });
      }
    }
  }

  if (toDelete.length === 0) {
    if (days === undefined) console.log('Nothing else to clean up.');
    return;
  }

  console.log(`\nCandidates for rule-based deletion: ${toDelete.length}`);
  for (const item of toDelete.slice(0, 30)) {
    const short = item.prompt.replace(/\n/g, ' ').slice(0, 60);
    console.log(`  #${String(item.id).padEnd(5)} [${item.reason}] "${short}"`);
  }
  if (toDelete.length > 30) {
    console.log(`  ... and ${toDelete.length - 30} more`);
  }

  if (dryRun) {
    console.log(`\n(dry-run) Would delete ${toDelete.length} more prompts. Run without --dry-run to apply.`);
    return;
  }

  const ids = toDelete.map(e => e.id);
  const deleted = db.deleteByIds(ids);
  console.log(`\nDeleted ${deleted} prompts.`);
}

async function cmdVacuum(db: PhDB): Promise<void> {
  process.stdout.write('Compacting database (VACUUM)... ');
  const start = Date.now();
  db.vacuum();
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`Done in ${elapsed}s.`);
}

async function cmdSessions(db: PhDB, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const gapHours = Number(flags['gap-hours'] ?? 2);
  const limit = Number(flags['limit'] ?? 20);
  const minSize = Number(flags['min-size'] ?? 1);
  const noCohesion = Boolean(flags['no-cohesion']);

  const C = {
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    gray: '\x1b[90m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
  };

  function fmtDate(ts: string): string {
    const d = new Date(ts);
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${yr}-${mo}-${dy} ${hh}:${mm}`;
  }

  function fmtTime(ts: string): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  // Load all prompts in DESC order, then reverse to ASC
  const allEntries = db.search({ limit: 100000 });
  const entriesAsc = [...allEntries].reverse();

  const sessions = groupIntoSessions(entriesAsc, gapHours);

  // Load embeddings and compute cohesion unless --no-cohesion
  let embeddings: Map<number, Float32Array> | null = null;
  if (!noCohesion) {
    embeddings = db.getAllEmbeddings();
  }

  for (const session of sessions) {
    if (embeddings) {
      session.cohesion = computeSessionCohesion(session, embeddings);
    }
  }

  // Filter by min-size
  const filtered = sessions.filter(s => s.entries.length >= minSize);

  // Take the last `limit` sessions (most recent)
  const visible = filtered.slice(-limit);

  if (visible.length === 0) {
    process.stdout.write('No sessions found.\n');
    return;
  }

  for (const session of visible) {
    // Determine dominant project and language (>50% frequency)
    const projectCounts = new Map<string, number>();
    const languageCounts = new Map<string, number>();
    for (const entry of session.entries) {
      let meta: PromptMetadata = {};
      try { meta = JSON.parse(entry.metadata) as PromptMetadata; } catch {}
      if (meta.project) projectCounts.set(meta.project, (projectCounts.get(meta.project) ?? 0) + 1);
      if (meta.language) languageCounts.set(meta.language, (languageCounts.get(meta.language) ?? 0) + 1);
    }

    const total = session.entries.length;
    let dominantProject: string | null = null;
    let dominantLanguage: string | null = null;

    for (const [proj, count] of projectCounts) {
      if (count / total > 0.5) { dominantProject = proj; break; }
    }
    for (const [lang, count] of languageCounts) {
      if (count / total > 0.5) { dominantLanguage = lang; break; }
    }

    // Build session header
    const startStr = fmtDate(session.startTime.toISOString());
    const endStr = fmtTime(session.endTime.toISOString());
    const promptWord = session.entries.length === 1 ? 'prompt' : 'prompts';

    let header = `${C.cyan}Session ${session.index}${C.reset}`;
    header += `  ${C.gray}·${C.reset}  ${startStr}  →  ${endStr}`;
    header += `  ${C.gray}·${C.reset}  ${C.yellow}${session.entries.length} ${promptWord}${C.reset}`;

    if (dominantProject && dominantLanguage) {
      header += `  ${C.gray}·  [${dominantProject}:${dominantLanguage}]${C.reset}`;
    } else if (dominantProject) {
      header += `  ${C.gray}·  [${dominantProject}]${C.reset}`;
    } else if (dominantLanguage) {
      header += `  ${C.gray}·  [${dominantLanguage}]${C.reset}`;
    }

    if (session.cohesion !== null) {
      header += `  ${C.gray}·  cohesion: ${session.cohesion.toFixed(2)}${C.reset}`;
    }

    process.stdout.write(header + '\n');

    // Print each entry
    for (const entry of session.entries) {
      let meta: PromptMetadata = {};
      try { meta = JSON.parse(entry.metadata) as PromptMetadata; } catch {}

      const idStr = `${C.cyan}#${entry.id}${C.reset}`;
      const toolStr = `${C.yellow}${entry.tool.padEnd(8)}${C.reset}`;
      const timeStr = `${C.gray}${fmtTime(entry.timestamp)}${C.reset}`;

      let rolePart = '';
      if (meta.role) rolePart = `  ${C.magenta}{${meta.role}}${C.reset}`;

      let tagsPart = '';
      if (meta.tags && meta.tags.length > 0) tagsPart = `  ${C.cyan}(${meta.tags.join(', ')})${C.reset}`;

      const preview = entry.prompt.replace(/\n/g, ' ').slice(0, 80);

      process.stdout.write(`  ${idStr}  ${toolStr}  ${timeStr}${rolePart}${tagsPart}  ${preview}\n`);
    }

    process.stdout.write('\n');
  }
}

async function cmdStats(db: PhDB): Promise<void> {
  const stats = getStats(db);
  const C = {
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    gray: '\x1b[90m',
    magenta: '\x1b[35m',
  };

  console.log(`${C.cyan}ph — Prompt History Statistics${C.reset}\n`);
  console.log(`  Total prompts:  ${C.yellow}${stats.total}${C.reset}`);
  console.log(`  Analyzed:       ${C.yellow}${stats.analyzed}${C.reset} (${Math.round((stats.analyzed / (stats.total || 1)) * 100)}%)`);
  console.log(`  Starred:        ${C.yellow}${stats.starred}${C.reset}`);
  
  if (stats.avgRelevance > 0 || stats.avgQuality > 0) {
    console.log(`\n${C.cyan}Global Scores:${C.reset}`);
    console.log(`  - Avg Relevance: ${C.yellow}${stats.avgRelevance.toFixed(1)}/10${C.reset}`);
    console.log(`  - Avg Quality:   ${C.yellow}${stats.avgQuality.toFixed(1)}/10${C.reset}`);
  }
  
  console.log(`\n${C.cyan}By Tool:${C.reset}`);
  Object.entries(stats.byTool).sort((a, b) => b[1] - a[1]).forEach(([tool, count]) => {
    console.log(`  - ${tool.padEnd(12)}: ${C.yellow}${count}${C.reset}`);
  });

  if (Object.keys(stats.byProject).length > 0) {
    console.log(`\n${C.cyan}Top Projects:${C.reset}`);
    Object.entries(stats.byProject).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([proj, count]) => {
      console.log(`  - ${proj.padEnd(20)}: ${C.yellow}${count}${C.reset}`);
    });
  }

  if (Object.keys(stats.byLanguage).length > 0) {
    console.log(`\n${C.cyan}Top Languages:${C.reset}`);
    Object.entries(stats.byLanguage).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([lang, count]) => {
      console.log(`  - ${lang.padEnd(12)}: ${C.yellow}${count}${C.reset}`);
    });
  }

  if (Object.keys(stats.byRole).length > 0) {
    console.log(`\n${C.cyan}By Role:${C.reset}`);
    Object.entries(stats.byRole).sort((a, b) => b[1] - a[1]).forEach(([role, count]) => {
      console.log(`  - ${role.padEnd(12)}: ${C.yellow}${count}${C.reset}`);
    });
  }
  console.log();
}

async function cmdCluster(db: PhDB, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const k = Number(flags['k'] ?? 5);
  const limitPerCluster = Number(flags['limit'] ?? 3);

  const embeddings = db.getAllEmbeddings();
  if (embeddings.size === 0) {
    console.error('ph: no embeddings found. Run `ph embed-all` first.');
    return;
  }

  console.log(`Clustering ${embeddings.size} prompts into ${k} groups...`);
  const clusters = kmeans(embeddings, k);

  const C = {
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    gray: '\x1b[90m',
  };

  clusters.forEach((cluster, i) => {
    if (cluster.entryIds.length === 0) return;
    console.log(`\n${C.cyan}Cluster #${i + 1}${C.reset} (${C.yellow}${cluster.entryIds.length} prompts${C.reset})`);
    
    // Show some examples from this cluster
    const examples = cluster.entryIds.slice(0, limitPerCluster);
    examples.forEach(id => {
      const entry = db.getById(id);
      if (entry) {
        const preview = entry.prompt.replace(/\n/g, ' ').slice(0, 80);
        console.log(`  ${C.gray}#${entry.id}${C.reset}  ${preview}`);
      }
    });
    if (cluster.entryIds.length > limitPerCluster) {
      console.log(`  ${C.gray}... and ${cluster.entryIds.length - limitPerCluster} more${C.reset}`);
    }
  });
  console.log();
}

async function cmdAnalyzeReusability(db: PhDB, args: string[]): Promise<void> {
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

async function cmdCleanupReusability(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
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

  // Calc sizes
  const totalSize = candidates.reduce((sum, c) => sum + c.promptSize + c.responseSize, 0);
  const totalEmbeddingSize = candidates.filter(c => c.hasEmbedding).length * 768 * 4; // estimate for 768-dim float32
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

  // Group by role
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

async function cmdWrap(dbPath: string, tool: string, args: string[], cfg: PhConfig): Promise<void> {
  // Strip --ph-tag, --ph-role and --ph-debug from args before passing to real tool
  let debugLog: string | undefined;
  let role: string | undefined;
  const tags: string[] = [];
  const cleanArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ph-debug') {
      debugLog = path.join(os.homedir(), '.ph_debug.log');
      process.stderr.write(`ph: debug log → ${debugLog}\n`);
    } else if (args[i] === '--ph-tag' && i + 1 < args.length) {
      tags.push(args[i + 1]);
      i++;
    } else if (args[i].startsWith('--ph-tag=')) {
      tags.push(args[i].slice('--ph-tag='.length));
    } else if (args[i] === '--ph-role' && i + 1 < args.length) {
      role = args[i + 1];
      i++;
    } else if (args[i].startsWith('--ph-role=')) {
      role = args[i].slice('--ph-role='.length);
    } else {
      cleanArgs.push(args[i]);
    }
  }

  let realBin: string;
  try {
    realBin = resolveRealBinary(tool);
  } catch (e: unknown) {
    process.stderr.write(`ph: cannot find "${tool}": ${(e as Error).message}\n`);
    process.exit(1);
  }

  const interactive = cleanArgs.length === 0 && isTerminal();

  const db = new PhDB(dbPath);

  if (interactive) {
    const workdir = process.cwd();
    const { rootDir, projectName } = detectProject(workdir);
    const language = detectLanguage(rootDir);
    const gitContext = captureGitContext(workdir);

    const onPrompt = (prompt: string, ts: Date): number => {
      const metaObj: Record<string, unknown> = {};
      if (projectName) metaObj.project = projectName;
      if (language) metaObj.language = language;
      if (role) metaObj.role = role;
      if (tags.length > 0) metaObj.tags = tags;
      if (gitContext) metaObj.git_context = gitContext;
      const metadata = Object.keys(metaObj).length > 0 ? JSON.stringify(metaObj) : '{}';

      return db.insert({
        timestamp: ts.toISOString(),
        tool,
        prompt,
        response: '',
        args: prompt,
        workdir,
        hostname: os.hostname(),
        exit_code: 0,
        metadata,
      });
    };

    const onResponse = (id: number, response: string) => {
      if (!response.trim()) return;
      db.updateResponse(id, response);
      if (cfg.backgroundAnalysis) {
        spawnBackgroundAnalysis(id, dbPath);
      }
    };

    const exitCode = await runPTY(realBin!, cleanArgs, onPrompt, onResponse, debugLog);
    db.close();
    process.exit(exitCode);
  } else {
    await runInline(realBin!, cleanArgs, db, tool, tags, role, (id) => {
      if (cfg.backgroundAnalysis) {
        spawnBackgroundAnalysis(id, dbPath);
      }
    });
    // runInline calls process.exit itself
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Load config first
  const cfg = loadConfig();
  if (cfg.geminiApiKey) {
    process.env.GEMINI_API_KEY = cfg.geminiApiKey;
  }

  const dbPath = process.env.PH_DB ?? cfg.dbPath ?? defaultPath();

  if (argv.length === 0) {
    if (isTerminal()) {
      const db = new PhDB(dbPath);
      process.stdout.write('\x1b[?1049h');
      let pendingRerun: { tool: string; prompt: string } | null = null;
      try {
        const { waitUntilExit } = render(
          React.createElement(BrowseApp, {
            db,
            onRerun: (tool, prompt) => { pendingRerun = { tool, prompt }; }
          })
        );
        await waitUntilExit();
      } finally {
        process.stdout.write('\x1b[?1049l');
        db.close();
      }
      if (pendingRerun) {
        const { tool, prompt } = pendingRerun;
        const realBin = resolveRealBinary(tool);
        const child = spawnSync(realBin, [prompt], { stdio: 'inherit' });
        process.exit(child.status ?? 0);
      }
      process.exit(0);
    } else {
      process.stdout.write(USAGE);
      process.exit(0);
    }
  }

  // Find first non-flag argument, skipping --ph-tag <value> and --ph-debug
  let cmdIdx = -1;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('-')) {
      if (argv[i] === '--ph-tag' || argv[i] === '--ph-role') i++; // skip value
      continue;
    }
    cmdIdx = i;
    break;
  }

  if (cmdIdx === -1) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const command = argv[cmdIdx];
  const cmdArgs = argv.slice(cmdIdx + 1);
  const preArgs = argv.slice(0, cmdIdx); // pre-tool flags like --ph-tag

  switch (command) {
    case 'search': {
      const { flags, positional } = parseFlags(cmdArgs);
      const query = positional.join(' ');
      
      if (flags['i'] || flags['interactive']) {
        const db = new PhDB(dbPath);
        process.stdout.write('\x1b[?1049h');
        let pendingRerun: { tool: string; prompt: string } | null = null;
        try {
          const { waitUntilExit } = render(
            React.createElement(BrowseApp, {
              db,
              initialTextFilter: query,
              initialFilters: {
                tool: flags['tool'] as string,
                project: flags['project'] as string,
                language: flags['language'] as string,
                role: flags['role'] as string,
                tag: flags['tag'] as string,
                starred: Boolean(flags['starred']),
                minQuality: flags['top'] ? 8 : (flags['min-quality'] ? Number(flags['min-quality']) : undefined),
                minRelevance: flags['min-relevance'] ? Number(flags['min-relevance']) : undefined,
              },
              onRerun: (tool, prompt) => { pendingRerun = { tool, prompt }; }
            })
          );
          await waitUntilExit();
        } finally {
          process.stdout.write('\x1b[?1049l');
          db.close();
        }
        if (pendingRerun) {
          const { tool, prompt } = pendingRerun;
          const realBin = resolveRealBinary(tool);
          const child = spawnSync(realBin, [prompt], { stdio: 'inherit' });
          process.exit(child.status ?? 0);
        }
        break;
      }

      const db = new PhDB(dbPath);
      await cmdSearch(db, cfg, cmdArgs);
      db.close();
      break;
    }
    case 'last': {
      const db = new PhDB(dbPath);
      await cmdLast(db, cmdArgs);
      db.close();
      break;
    }
    case 'sessions': {
      const db = new PhDB(dbPath);
      await cmdSessions(db, cmdArgs);
      db.close();
      break;
    }
    case 'stats': {
      const db = new PhDB(dbPath);
      await cmdStats(db);
      db.close();
      break;
    }
    case 'cluster': {
      const db = new PhDB(dbPath);
      await cmdCluster(db, cmdArgs);
      db.close();
      break;
    }
    case 'analyze-reusability': {
      const db = new PhDB(dbPath);
      await cmdAnalyzeReusability(db, cmdArgs);
      db.close();
      break;
    }
    case 'cleanup-reusability': {
      const db = new PhDB(dbPath);
      await cmdCleanupReusability(db, cfg, cmdArgs);
      db.close();
      break;
    }
    case 'star': {
      const db = new PhDB(dbPath);
      await cmdStar(db, cmdArgs);
      db.close();
      break;
    }
    case 'export': {
      const db = new PhDB(dbPath);
      await cmdExport(db, cmdArgs);
      db.close();
      break;
    }
    case 'import': {
      const db = new PhDB(dbPath);
      await cmdImport(db, cfg, cmdArgs);
      db.close();
      break;
    }
    case 'analyze': {
      const db = new PhDB(dbPath);
      await cmdAnalyze(db, cfg, cmdArgs);
      db.close();
      break;
    }
    case 'log': {
      await cmdLog(dbPath, cfg, cmdArgs);
      break;
    }
    case 'embed-all': {
      const db = new PhDB(dbPath);
      await cmdEmbedAll(db, cfg);
      db.close();
      break;
    }
    case 'cleanup': {
      const db = new PhDB(dbPath);
      await cmdCleanup(db, cfg, cmdArgs);
      db.close();
      break;
    }
    case 'config':
      cmdConfig(cmdArgs);
      break;

    case '_bg-analyze': {
      await cmdBackgroundAnalyze(dbPath, cmdArgs);
      break;
    }

    case 'browse': {
      const db = new PhDB(dbPath);
      process.stdout.write('\x1b[?1049h');
      let pendingRerun: { tool: string; prompt: string } | null = null;
      try {
        const { waitUntilExit } = render(
          React.createElement(BrowseApp, {
            db,
            onRerun: (tool, prompt) => { pendingRerun = { tool, prompt }; }
          })
        );
        await waitUntilExit();
      } finally {
        process.stdout.write('\x1b[?1049l');
        db.close();
      }
      if (pendingRerun) {
        const { tool, prompt } = pendingRerun;
        const realBin = resolveRealBinary(tool);
        const child = spawnSync(realBin, [prompt], { stdio: 'inherit' });
        process.exit(child.status ?? 0);
      }
      break;
    }

    case 'ollama-models': {
      const ollamaUrl = cfg.ollamaUrl ?? 'http://localhost:11434';
      try {
        const res = await fetch(`${ollamaUrl}/api/tags`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { models?: Array<{ name: string }> };
        const models = (data.models ?? []).map(m => m.name).filter(Boolean);
        if (models.length === 0) {
          console.log('No models found.');
        } else {
          console.log(`Available Ollama models at ${ollamaUrl}:`);
          for (const m of models) console.log(`  ${m}`);
        }
      } catch (err: unknown) {
        process.stderr.write(`ph: cannot reach Ollama at ${ollamaUrl}: ${(err as Error).message}\n`);
        process.exit(1);
      }
      break;
    }

    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(USAGE);
      break;

    default:
      // Transparent wrap mode: merge pre-tool flags with post-tool args
      await cmdWrap(dbPath, command, [...preArgs, ...cmdArgs], cfg);
      break;
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`ph: ${(e as Error).message}\n`);
  process.exit(1);
});
