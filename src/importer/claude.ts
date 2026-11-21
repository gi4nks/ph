import fs from 'fs';
import path from 'path';
import os from 'os';
import { PhDB } from '../db/index.js';
import type { LLMProvider } from '../ai/provider.js';
import { analyzePrompt, mergeMetadata } from '../analyzer/index.js';
import type { FilterPipeline } from '../filter/index.js';
import type { ImportResult } from '../types.js';
import { createCaptureRecord } from '../capture/index.js';

const MAX_RESPONSE_LENGTH = 8000;
const TRUNCATION_SUFFIX = '\n... (truncated)';

interface TranscriptContentPart {
  type: string;
  text?: string;
}

type TranscriptRecord = Record<string, unknown>;

export interface ClaudeTranscriptEntry {
  prompt: string;
  response: string;
  timestamp: string;
  workdir: string;
  sessionId: string;
}

/**
 * Convert a Claude project directory slug back to an absolute filesystem path.
 * The slug format is a path with slashes replaced by dashes and a leading dash
 * representing the leading slash. E.g. `-Users-example-foo` → `/Users/example/foo`.
 */
function slugToPath(slug: string): string {
  // The slug starts with a dash representing the root separator.
  // Replace all dashes with slashes, then ensure a leading slash.
  // However, dashes within path segments are also dashes, so we use a heuristic:
  // the slug is produced by replacing '/' with '-', so we replace every '-' with '/'.
  // The leading '-' was the leading '/', so after replacement we get a path starting with '/'.
  return slug.replace(/-/g, '/');
}

/**
 * Extract text from an assistant message's content parts (skip thinking/tool_use/tool_result).
 */
function extractAssistantText(parts: TranscriptContentPart[]): string {
  return parts
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
}

/**
 * Truncate a response to MAX_RESPONSE_LENGTH with a truncation suffix if needed.
 */
function truncateResponse(text: string): string {
  if (text.length <= MAX_RESPONSE_LENGTH) return text;
  return text.slice(0, MAX_RESPONSE_LENGTH - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function extractPromptFromRecord(record: TranscriptRecord): string | null {
  if (record.toolUseResult !== undefined && record.toolUseResult !== null && record.toolUseResult !== false && record.toolUseResult !== '') {
    return null;
  }

  const message = asObject(record.message);
  const hasPromptId = 'promptId' in record && record.promptId !== undefined && record.promptId !== null;
  if (message && (message.role === 'user' || hasPromptId)) {
    if (typeof message.content === 'string') {
      const trimmed = message.content.trim();
      return trimmed || null;
    }
    if (hasPromptId && Array.isArray(message.content)) {
      const parts = message.content as TranscriptContentPart[];
      if (parts.some((p) => p?.type === 'tool_result')) return null;
      const trimmed = extractAssistantText(parts).trim();
      return trimmed || null;
    }
  }

  if (record.type === 'user' && typeof record.content === 'string') {
    const trimmed = record.content.trim();
    return trimmed || null;
  }

  return null;
}

function extractAssistantFromRecord(record: TranscriptRecord): string {
  const message = asObject(record.message);
  if (message?.role === 'assistant') {
    if (Array.isArray(message.content)) {
      return extractAssistantText(message.content as TranscriptContentPart[]);
    }
    if (typeof message.content === 'string') {
      return message.content;
    }
  }

  if (record.type === 'assistant') {
    if (Array.isArray(record.content)) {
      return extractAssistantText(record.content as TranscriptContentPart[]);
    }
    if (typeof record.content === 'string') {
      return record.content;
    }
  }

  return '';
}

/**
 * Read all lines from a JSONL file and parse them as transcript messages.
 * Ignores unparseable lines silently (caller handles error tracking separately).
 */
function parseTranscriptFile(filePath: string, errors: string[]): TranscriptRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e: unknown) {
    errors.push(`read ${filePath}: ${(e as Error).message}`);
    return [];
  }

  const messages: TranscriptRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const obj = asObject(parsed);
      if (obj) messages.push(obj);
    } catch {
      // skip unparseable lines
    }
  }
  return messages;
}

/** Parse a modern or legacy Claude Code JSONL transcript into prompt/response turns. */
export function parseClaudeTranscript(
  filePath: string,
  fallbackWorkdir = '',
): { entries: ClaudeTranscriptEntry[]; error?: string } {
  const errors: string[] = [];
  const messages = parseTranscriptFile(filePath, errors);
  if (errors.length > 0) {
    return { entries: [], error: errors[0] };
  }

  const sessionId = path.basename(filePath, '.jsonl');
  const entries: ClaudeTranscriptEntry[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prompt = extractPromptFromRecord(msg);
    if (!prompt) continue;

    const responseParts: string[] = [];
    for (let j = i + 1; j < messages.length; j++) {
      if (extractPromptFromRecord(messages[j]) !== null) break;
      const chunk = extractAssistantFromRecord(messages[j]);
      if (chunk) responseParts.push(chunk);
    }

    const workdir = typeof msg.cwd === 'string' && msg.cwd.trim() ? msg.cwd.trim() : fallbackWorkdir;
    const timestamp = typeof msg.timestamp === 'string' && msg.timestamp
      ? msg.timestamp
      : new Date(0).toISOString();

    entries.push({
      prompt,
      response: truncateResponse(responseParts.join('\n')),
      timestamp,
      workdir,
      sessionId,
    });
  }

  return { entries };
}

/**
 * Walk ~/.claude/projects/ and return all *.jsonl file paths, grouped by project slug.
 */
function findTranscriptFiles(claudeDir: string): { filePath: string; projectSlug: string }[] {
  const projectsDir = path.join(claudeDir, 'projects');
  const result: { filePath: string; projectSlug: string }[] = [];

  if (!fs.existsSync(projectsDir)) return result;

  let projectEntries: fs.Dirent[];
  try {
    projectEntries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of projectEntries) {
    if (!entry.isDirectory()) continue;
    const projectSlug = entry.name;
    const projectDir = path.join(projectsDir, projectSlug);

    let sessionEntries: fs.Dirent[];
    try {
      sessionEntries = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const sessionEntry of sessionEntries) {
      if (!sessionEntry.isFile() || !sessionEntry.name.endsWith('.jsonl')) continue;
      result.push({
        filePath: path.join(projectDir, sessionEntry.name),
        projectSlug,
      });
    }
  }

  return result;
}

export async function importClaudeHistory(
  db: PhDB,
  claudeDir: string,
  dryRun: boolean,
  analyzer?: LLMProvider,
  onProgress?: (evaluated: number, imported: number, total: number, current: string) => void,
  filter?: FilterPipeline
): Promise<ImportResult> {
  const result: ImportResult = {
    filesScanned: 0,
    promptsFound: 0,
    promptsImported: 0,
    skipped: 0,
    filtered: 0,
    errors: [],
  };

  const transcriptFiles = findTranscriptFiles(claudeDir);
  result.filesScanned = transcriptFiles.length;

  if (transcriptFiles.length === 0) return result;

  const hostname = os.hostname();

  // Collect all prompt+response pairs across all files for progress tracking
  const pendingEntries: ClaudeTranscriptEntry[] = [];

  for (const { filePath, projectSlug } of transcriptFiles) {
    const parsed = parseClaudeTranscript(filePath, slugToPath(projectSlug));
    if (parsed.error) {
      result.errors.push(parsed.error);
      continue;
    }
    pendingEntries.push(...parsed.entries);
  }

  const totalPromptsToEvaluate = pendingEntries.length;
  let promptsEvaluated = 0;

  for (const entry of pendingEntries) {
    promptsEvaluated++;
    result.promptsFound++;

    onProgress?.(promptsEvaluated, result.promptsImported, totalPromptsToEvaluate, entry.prompt.slice(0, 60));

    if (dryRun) {
      result.promptsImported++;
      continue;
    }

    // Stage 1+2: rule-based + dedup filter (no LLM)
    if (filter) {
      const preCheck = filter.checkRules(entry.prompt);
      if (!preCheck.keep) { result.filtered++; continue; }
      const dupCheck = filter.checkDuplicate(entry.prompt);
      if (!dupCheck.keep) { result.filtered++; continue; }
    }

    try {
      let metadata = '{}';

      if (analyzer) {
        try {
          const analysis = await analyzePrompt(entry.prompt, analyzer);
          // Stage 3: relevance filter (LLM score)
          if (filter && analysis) {
            const relCheck = filter.checkRelevance(analysis);
            if (!relCheck.keep) { result.filtered++; continue; }
          }
          const merged = mergeMetadata({}, analysis, false);
          if (Object.keys(merged).length > 0) metadata = JSON.stringify(merged);
        } catch {
          // analysis failure is non-fatal
        }
      }

      const id = db.insert(createCaptureRecord({
        timestamp: entry.timestamp,
        tool: 'claude',
        prompt: entry.prompt,
        response: entry.response,
        args: entry.prompt,
        workdir: entry.workdir,
        hostname,
        exit_code: 0,
        metadata: JSON.parse(metadata) as Record<string, unknown>,
      }));
      filter?.registerHash(entry.prompt, id);
      result.promptsImported++;
    } catch (e: unknown) {
      result.errors.push(
        `insert session ${entry.sessionId}: ${(e as Error).message}`
      );
      result.skipped++;
    }
  }

  return result;
}
