import path from 'path';
import os from 'os';
import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { importGeminiHistory } from '../importer/gemini.js';
import { importClaudeHistory } from '../importer/claude.js';
import { importOpenCodeHistory } from '../importer/opencode.js';
import { importCodexHistory, parseCodexRollout } from '../importer/codex.js';
import { importAgyHistory, parseAgyTranscript, resolveFullTranscriptFile } from '../importer/agy.js';
import { getProvider, getProviderSetupError } from '../ai/provider.js';
import { FilterPipeline } from '../filter/index.js';
import { parseFlags } from './_utils.js';
import { completeLiveCapture, prepareLiveCapture } from '../capture/lifecycle.js';
import { captureHash } from '../utils/captureHash.js';
import { detectProject } from '../runner/project.js';

interface FileTurnContext {
  tool: string;
  workdir: string;
  response: string;
}

function buildFileContextQueue(
  source: string,
  transcriptFile: string,
  workdirOverride?: string,
): Map<string, FileTurnContext[]> {
  const queue = new Map<string, FileTurnContext[]>();
  const enqueue = (prompt: string, ctx: FileTurnContext): void => {
    const bucket = queue.get(prompt);
    if (bucket) bucket.push(ctx);
    else queue.set(prompt, [ctx]);
  };

  if (source === 'codex') {
    const parsed = parseCodexRollout(transcriptFile, workdirOverride);
    for (const entry of parsed.entries) {
      enqueue(entry.prompt, { tool: 'codex', workdir: entry.workdir, response: entry.response });
    }
  } else if (source === 'agy' || source === 'antigravity') {
    const parsed = parseAgyTranscript(resolveFullTranscriptFile(transcriptFile), workdirOverride);
    for (const item of parsed.interactions) {
      enqueue(item.prompt, { tool: 'agy', workdir: item.workdir, response: item.response });
    }
  }

  return queue;
}

export async function cmdImport(db: PhDB, cfg: PhConfig, args: string[]): Promise<void> {
  if (args.length === 0) {
    process.stderr.write('Usage: ph import <source> [--dry-run] [--analyze] [--filter] [--file <path>] [--workdir <path>] [--live]\n');
    process.stderr.write('Supported sources: gemini, claude, opencode, codex, agy\n');
    process.exit(1);
  }

  const source = args[0];
  const { flags } = parseFlags(args.slice(1));
  const dryRun = Boolean(flags['dry-run']);
  const analyze = Boolean(flags['analyze']);
  const useFilter = Boolean(flags['filter']);
  const isLive = Boolean(flags['live']);
  const transcriptFile = typeof flags.file === 'string' ? flags.file : undefined;
  const workdirOverride = typeof flags.workdir === 'string' ? flags.workdir : undefined;
  const homeDir = os.homedir();

  if (dryRun) console.log('Dry run — nothing will be written to the database.');

  let analyzer;
  if (analyze) {
    analyzer = getProvider(cfg);
    if (!analyzer) {
      const detail = getProviderSetupError(cfg) ?? 'No LLM provider is configured. Run: ph config set analyze-provider ollama';
      process.stderr.write(`ph: ${detail}\n`);
      process.exit(1);
    }
    console.log(`Analyzing with ${analyzer.name} during import...`);
  }

  let filter: FilterPipeline;
  const existingHashes = (dryRun || transcriptFile) ? new Map<string, number>() : db.getAllPromptHashes();

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

  if (transcriptFile && !dryRun) {
    const contextQueue = buildFileContextQueue(source, transcriptFile, workdirOverride);
    const seenCaptureHashes = new Map<string, number>();
    const pendingHashes = new Map<string, string>();
    const baseCheckRules = filter.checkRules.bind(filter);
    const baseCheckDuplicate = filter.checkDuplicate.bind(filter);
    const baseRegisterHash = filter.registerHash.bind(filter);

    filter.checkRules = (text: string) => {
      const rulesResult = baseCheckRules(text);
      if (!rulesResult.keep) {
        contextQueue.get(text)?.shift();
      }
      return rulesResult;
    };

    filter.checkDuplicate = (text: string) => {
      const ctx = contextQueue.get(text)?.shift();
      if (ctx) {
        const resolvedWorkdir = ctx.workdir.trim() || detectProject(ctx.workdir).projectName;
        const capHash = captureHash({
          tool: ctx.tool,
          workdir: resolvedWorkdir,
          prompt: text,
          response: ctx.response,
        });
        const seenId = seenCaptureHashes.get(capHash);
        if (seenId !== undefined) {
          return { keep: false, reason: 'exact_duplicate', details: `duplicate of #${seenId}` };
        }
        const existingId = db.getPromptIdByCaptureHash(capHash);
        if (existingId !== undefined) {
          seenCaptureHashes.set(capHash, existingId);
          return { keep: false, reason: 'exact_duplicate', details: `duplicate of #${existingId}` };
        }
        pendingHashes.set(text, capHash);
        return { keep: true };
      }

      const intraBatch = baseCheckDuplicate(text);
      if (!intraBatch.keep) return intraBatch;
      const existingId = db.getPromptIdByHash(FilterPipeline.hashPrompt(text));
      if (existingId !== undefined) {
        baseRegisterHash(text, existingId);
        return { keep: false, reason: 'exact_duplicate', details: `duplicate of #${existingId}` };
      }
      return { keep: true };
    };

    filter.registerHash = (text: string, id: number) => {
      const capHash = pendingHashes.get(text);
      if (capHash !== undefined) {
        seenCaptureHashes.set(capHash, id);
        pendingHashes.delete(text);
        return;
      }
      baseRegisterHash(text, id);
    };
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
      result = await importOpenCodeHistory(db, path.join(homeDir, '.local', 'share', 'opencode', 'storage'), dryRun, analyzer, onProgress, filter, transcriptFile, workdirOverride);
      break;
    case 'codex':
      result = await importCodexHistory(db, path.join(homeDir, '.codex'), dryRun, analyzer, onProgress, filter, transcriptFile, workdirOverride);
      break;
    case 'agy':
    case 'antigravity':
      result = await importAgyHistory(db, path.join(homeDir, '.gemini'), dryRun, analyzer, onProgress, filter, transcriptFile, workdirOverride);
      break;
    default:
      process.stderr.write(`ph: unknown import source "${source}". Supported: gemini, claude, opencode, codex, agy\n`);
      process.exit(1);
  }

  if (analyze) process.stdout.write('\n');

  if (isLive && (result.importedIds?.length ?? 0) > 0) {
    for (const id of result.importedIds!) {
      const entry = db.getById(id);
      if (entry) {
        const prepared = prepareLiveCapture(entry, cfg);
        db.updateMetadata(id, prepared.metadata);
      }
      await completeLiveCapture(db.dbPath, cfg, id);
    }
  }

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
