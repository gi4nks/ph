import fs from 'fs';
import path from 'path';
import os from 'os';
import { PhDB } from '../db/index.js';
import type { LLMProvider } from '../ai/provider.js';
import { analyzePrompt, mergeMetadata } from '../analyzer/index.js';
import type { FilterPipeline } from '../filter/index.js';
import type { ImportResult } from '../types.js';

interface GeminiMessage {
  id?: string;
  timestamp: string;
  type: string;
  content: string | Array<{ text: string }>;
}

interface GeminiSession {
  messages: GeminiMessage[];
}

function getContent(msg: GeminiMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.map((c) => c.text || '').join('');
  }
  return '';
}

function findSessionFiles(tmpDir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(tmpDir)) return files;

  try {
    const hashes = fs.readdirSync(tmpDir);
    for (const hash of hashes) {
      const chatsDir = path.join(tmpDir, hash, 'chats');
      if (!fs.existsSync(chatsDir)) continue;
      const sessions = fs.readdirSync(chatsDir).filter(
        (f) => f.startsWith('session-') && f.endsWith('.json')
      );
      for (const s of sessions) {
        files.push(path.join(chatsDir, s));
      }
    }
  } catch (_) {}
  return files;
}

function inferWorkDir(sessionPath: string, geminiDir: string): string {
  const tmpDir = path.join(geminiDir, 'tmp');
  const rel = path.relative(tmpDir, sessionPath);
  const parts = rel.split(path.sep);
  if (parts.length > 0) {
    const hash = parts[0];
    const historyDir = path.join(geminiDir, 'history', hash);
    if (fs.existsSync(path.join(historyDir, '.git'))) {
      return historyDir;
    }
  }
  return '';
}

export async function importGeminiHistory(
  db: PhDB,
  geminiDir: string,
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

  const files = findSessionFiles(path.join(geminiDir, 'tmp'));
  result.filesScanned = files.length;

  const hostname = os.hostname();

  // First pass: just count the total prompts so we can show a progress bar
  let totalPromptsToEvaluate = 0;
  for (const filePath of files) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const messages: GeminiMessage[] = Array.isArray(parsed) ? parsed : ((parsed as GeminiSession).messages || []);
      totalPromptsToEvaluate += messages.filter(m => (m.type === 'human' || m.type === 'user') && getContent(m) !== '').length;
    } catch {
      // ignore errors in this dry-run counting phase
    }
  }

  let promptsEvaluated = 0;

  for (const filePath of files) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      let messages: GeminiMessage[];

      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          messages = parsed as GeminiMessage[];
        } else {
          messages = (parsed as GeminiSession).messages || [];
        }
      } catch {
        result.errors.push(`${filePath}: JSON parse error`);
        continue;
      }

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (!((msg.type === 'human' || msg.type === 'user') && getContent(msg) !== '')) continue;

        result.promptsFound++;
        promptsEvaluated++;
        const content = getContent(msg);
        onProgress?.(promptsEvaluated, result.promptsImported, totalPromptsToEvaluate, content.slice(0, 60));

        if (dryRun) { result.promptsImported++; continue; }

        // Stage 1+2: rule-based + dedup filter (no LLM)
        if (filter) {
          const preCheck = filter.checkRules(content);
          if (!preCheck.keep) { result.filtered++; continue; }
          const dupCheck = filter.checkDuplicate(content);
          if (!dupCheck.keep) { result.filtered++; continue; }
        }

        let metadata = '{}';
        let analysis;

        if (analyzer) {
          try {
            analysis = await analyzePrompt(content, analyzer);
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

        // Capture the model response immediately following this user message
        let response = '';
        const nextMsg = messages[i + 1];
        if (nextMsg && (nextMsg.type === 'model' || nextMsg.type === 'assistant')) {
          response = getContent(nextMsg);
          if (response.length > 8000) response = response.slice(0, 8000) + '\n... (truncated)';
        }

        try {
          const id = db.insert({
            timestamp: new Date(msg.timestamp).toISOString(),
            tool: 'gemini',
            prompt: content,
            response,
            args: content,
            workdir: inferWorkDir(filePath, geminiDir),
            hostname,
            exit_code: 0,
            metadata,
          });
          filter?.registerHash(content, id);
          result.promptsImported++;
        } catch (e: unknown) {
          result.errors.push(`insert ${msg.id || '?'}: ${(e as Error).message}`);
          result.skipped++;
        }
      }
    } catch (e: unknown) {
      result.errors.push(`${filePath}: ${(e as Error).message}`);
    }
  }

  return result;
}
