import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PhDB } from '../db/index.js';
import { FilterPipeline } from '../filter/index.js';
import type { ImportResult, PromptMetadata } from '../types.js';
import { createCaptureRecord } from '../capture/index.js';
import type { LLMProvider } from '../ai/provider.js';
import { analyzePrompt, mergeMetadata } from '../analyzer/index.js';

interface AgyStep {
  step_index?: number;
  source?: string;
  type?: string;
  status?: string;
  created_at?: string;
  content?: string;
  truncated_fields?: string[];
  tool_calls?: Array<{ toolSummary?: string; CommandLine?: string; [key: string]: unknown }>;
}

function cleanUserPrompt(raw: string): string {
  let cleaned = raw.trim();
  const match = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i.exec(cleaned);
  if (match) {
    cleaned = match[1].trim();
  }
  return cleaned;
}

function resolveFullTranscriptFile(file: string): string {
  if (file.endsWith('transcript_full.jsonl')) return file;
  const dir = path.dirname(file);
  const fullCandidate = path.join(dir, 'transcript_full.jsonl');
  if (fs.existsSync(fullCandidate)) return fullCandidate;
  return file;
}

export function findAgyTranscriptFiles(baseDir: string): string[] {
  const results: string[] = [];

  // Check if baseDir itself is directly a conversation directory
  const directCandidate = path.join(baseDir, '.system_generated', 'logs', 'transcript.jsonl');
  if (fs.existsSync(directCandidate)) {
    return [resolveFullTranscriptFile(directCandidate)];
  }

  const searchRoots = [
    path.join(baseDir, 'antigravity-cli', 'brain'),
    path.join(baseDir, 'antigravity', 'brain'),
    path.join(baseDir, 'antigravity-ide', 'brain'),
    path.join(baseDir, 'brain'),
    baseDir,
  ];

  const seen = new Set<string>();

  for (const root of searchRoots) {
    if (!fs.existsSync(root)) continue;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(root, entry.name, '.system_generated', 'logs', 'transcript.jsonl');
        if (fs.existsSync(candidate)) {
          const resolved = resolveFullTranscriptFile(candidate);
          if (!seen.has(resolved)) {
            seen.add(resolved);
            results.push(resolved);
          }
        }
      }
    } catch {
      // ignore unreadable directories
    }
  }

  return results;
}

export async function importAgyHistory(
  db: PhDB,
  baseDir: string,
  dryRun: boolean,
  analyzer?: LLMProvider,
  onProgress?: (evaluated: number, imported: number, total: number, current: string) => void,
  filter?: FilterPipeline,
  transcriptFile?: string,
  workdirOverride?: string,
): Promise<ImportResult> {
  const result: ImportResult = {
    filesScanned: 0,
    promptsFound: 0,
    promptsImported: 0,
    skipped: 0,
    filtered: 0,
    errors: [],
    importedIds: [],
  };

  const dedupFilter = filter ?? new FilterPipeline({
    minLength: 0,
    minRelevance: 0,
    existingHashes: db.getAllPromptHashes(),
  });

  const files = transcriptFile
    ? [resolveFullTranscriptFile(transcriptFile)]
    : findAgyTranscriptFiles(baseDir);

  result.filesScanned = files.length;
  const hostname = os.hostname();
  const interactions: { prompt: string; response: string; timestamp: string; workdir: string; toolCalls: string[] }[] = [];

  for (const file of files) {
    let lines: string[];
    try {
      lines = fs.readFileSync(file, 'utf8').split('\n');
    } catch (error) {
      result.errors.push(`read ${file}: ${(error as Error).message}`);
      continue;
    }

    const steps: AgyStep[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const step = JSON.parse(line) as AgyStep;
        steps.push(step);
      } catch {
        // ignore malformed lines
      }
    }

    let defaultWorkdir = workdirOverride || process.cwd();

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const isUserInput = step.type === 'USER_INPUT' && (step.source === 'USER_EXPLICIT' || !step.source);
      if (!isUserInput || !step.content) continue;

      const prompt = cleanUserPrompt(step.content);
      if (!prompt) continue;

      let response = '';
      let responseTimestamp = step.created_at ?? new Date(0).toISOString();
      const toolCalls: string[] = [];

      // Find the final assistant response before the next USER_INPUT
      for (let j = i + 1; j < steps.length; j++) {
        const next = steps[j];
        if (next.type === 'USER_INPUT') break;
        if (Array.isArray(next.tool_calls)) {
          for (const tc of next.tool_calls) {
            if (tc.toolSummary) toolCalls.push(tc.toolSummary);
          }
        }
        if (next.type === 'PLANNER_RESPONSE' && next.content) {
          response = next.content.trim();
          if (next.created_at) responseTimestamp = next.created_at;
        }
      }

      interactions.push({
        prompt,
        response: response.slice(0, 8000),
        timestamp: step.created_at ?? responseTimestamp,
        workdir: defaultWorkdir,
        toolCalls,
      });
    }
  }

  for (let i = 0; i < interactions.length; i++) {
    const item = interactions[i];
    result.promptsFound++;
    onProgress?.(i + 1, result.promptsImported, interactions.length, item.prompt.slice(0, 60));

    if (dryRun) {
      result.promptsImported++;
      continue;
    }

    const rules = dedupFilter.checkRules(item.prompt);
    if (!rules.keep || !dedupFilter.checkDuplicate(item.prompt).keep) {
      result.filtered++;
      continue;
    }

    try {
      let metadata: PromptMetadata = {};
      if (analyzer) {
        try {
          metadata = mergeMetadata({}, await analyzePrompt(item.prompt, analyzer), false);
        } catch {
          // ignore analysis failure on import
        }
      }

      const id = db.insert(createCaptureRecord({
        timestamp: item.timestamp,
        tool: 'agy',
        prompt: item.prompt,
        response: item.response,
        args: item.prompt,
        workdir: item.workdir,
        hostname,
        exit_code: 0,
        metadata: {
          ...metadata,
          ...(item.toolCalls.length > 0 ? { tool_calls: item.toolCalls } : {}),
        },
      }));

      result.importedIds!.push(id);
      dedupFilter.registerHash(item.prompt, id);
      result.promptsImported++;
    } catch (error) {
      result.errors.push(`insert interaction: ${(error as Error).message}`);
      result.skipped++;
    }
  }

  return result;
}
