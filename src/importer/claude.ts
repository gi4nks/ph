import fs from 'fs';
import path from 'path';
import os from 'os';
import { PhDB } from '../db/index.js';
import type { LLMProvider } from '../ai/provider.js';
import { analyzePrompt, mergeMetadata } from '../analyzer/index.js';
import type { FilterPipeline } from '../filter/index.js';
import type { ImportResult } from '../types.js';

const MAX_RESPONSE_LENGTH = 8000;
const TRUNCATION_SUFFIX = '\n... (truncated)';

interface TranscriptUserMessage {
  type: 'user';
  content: string;
  timestamp: string;
}

interface TranscriptAssistantContentPart {
  type: string;
  text?: string;
}

interface TranscriptAssistantMessage {
  type: 'assistant';
  content: TranscriptAssistantContentPart[];
  timestamp: string;
}

type TranscriptMessage = TranscriptUserMessage | TranscriptAssistantMessage | { type: string };

/**
 * Convert a Claude project directory slug back to an absolute filesystem path.
 * The slug format is a path with slashes replaced by dashes and a leading dash
 * representing the leading slash. E.g. `-Users-gianluca-foo` → `/Users/gianluca/foo`.
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
function extractAssistantText(parts: TranscriptAssistantContentPart[]): string {
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

/**
 * Read all lines from a JSONL file and parse them as transcript messages.
 * Ignores unparseable lines silently (caller handles error tracking separately).
 */
function parseTranscriptFile(filePath: string, errors: string[]): TranscriptMessage[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e: unknown) {
    errors.push(`read ${filePath}: ${(e as Error).message}`);
    return [];
  }

  const messages: TranscriptMessage[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed) as TranscriptMessage);
    } catch {
      // skip unparseable lines
    }
  }
  return messages;
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
  interface PendingEntry {
    prompt: string;
    response: string;
    timestamp: string;
    workdir: string;
    sessionId: string;
  }

  const pendingEntries: PendingEntry[] = [];

  for (const { filePath, projectSlug } of transcriptFiles) {
    const messages = parseTranscriptFile(filePath, result.errors);
    const workdir = slugToPath(projectSlug);
    const sessionId = path.basename(filePath, '.jsonl');

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.type !== 'user') continue;

      const userMsg = msg as TranscriptUserMessage;
      const prompt = typeof userMsg.content === 'string' ? userMsg.content.trim() : '';
      if (!prompt) continue;

      // Look ahead for the assistant response
      let response = '';
      if (i + 1 < messages.length && messages[i + 1].type === 'assistant') {
        const assistantMsg = messages[i + 1] as TranscriptAssistantMessage;
        const rawText = extractAssistantText(assistantMsg.content ?? []);
        response = truncateResponse(rawText);
      }

      pendingEntries.push({
        prompt,
        response,
        timestamp: userMsg.timestamp,
        workdir,
        sessionId,
      });
    }
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

      const id = db.insert({
        timestamp: entry.timestamp,
        tool: 'claude',
        prompt: entry.prompt,
        response: entry.response,
        args: entry.prompt,
        workdir: entry.workdir,
        hostname,
        exit_code: 0,
        metadata,
      });
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
