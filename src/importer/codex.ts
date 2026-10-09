import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PhDB } from '../db/index.js';
import { FilterPipeline } from '../filter/index.js';
import type { ImportResult, PromptMetadata } from '../types.js';
import { createCaptureRecord } from '../capture/index.js';
import type { LLMProvider } from '../ai/provider.js';
import { analyzePrompt, mergeMetadata } from '../analyzer/index.js';

type RolloutEvent = { timestamp?: string; type?: string; payload?: Record<string, unknown> };

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((part) => {
    if (!part || typeof part !== 'object') return [];
    const item = part as Record<string, unknown>;
    return typeof item.text === 'string' && ['output_text', 'input_text', 'text'].includes(String(item.type))
      ? [item.text] : [];
  }).join('');
}

function rolloutFiles(sessionsDir: string): string[] {
  if (!fs.existsSync(sessionsDir)) return [];
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) files.push(full);
    }
  };
  visit(sessionsDir);
  return files;
}

export async function importCodexHistory(
  db: PhDB,
  codexDir: string,
  dryRun: boolean,
  analyzer?: LLMProvider,
  onProgress?: (evaluated: number, imported: number, total: number, current: string) => void,
  filter?: FilterPipeline,
  transcriptFile?: string,
): Promise<ImportResult> {
  const result: ImportResult = { filesScanned: 0, promptsFound: 0, promptsImported: 0, skipped: 0, filtered: 0, errors: [] };
  const dedupFilter = filter ?? new FilterPipeline({ minLength: 0, minRelevance: 0, existingHashes: db.getAllPromptHashes() });
  const files = transcriptFile ? [transcriptFile] : rolloutFiles(path.join(codexDir, 'sessions'));
  result.filesScanned = files.length;
  const hostname = os.hostname();
  const entries: { prompt: string; response: string; timestamp: string; workdir: string; sessionId: string }[] = [];

  for (const file of files) {
    let lines: string[];
    try { lines = fs.readFileSync(file, 'utf8').split('\n'); }
    catch (error) { result.errors.push(`read ${file}: ${(error as Error).message}`); continue; }
    let workdir = '';
    let sessionId = path.basename(file, '.jsonl').replace(/^rollout-.*?-/, '');
    const events: RolloutEvent[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as RolloutEvent;
        events.push(event);
        if (event.type === 'session_meta' && event.payload) {
          if (typeof event.payload.cwd === 'string') workdir = event.payload.cwd;
          if (typeof event.payload.id === 'string') sessionId = event.payload.id;
        }
      } catch { /* Ignore partial or malformed JSONL records. */ }
    }
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const payload = event.payload ?? {};
      const isUserMessage = (event.type === 'event_msg' && payload.type === 'user_message')
        || (event.type === 'response_item' && payload.type === 'message' && payload.role === 'user');
      const prompt = !isUserMessage ? '' : typeof payload.message === 'string'
        ? payload.message.trim() : textFromContent(payload.content).trim();
      if (!prompt) continue;
      const agentMessages: string[] = [];
      const assistantItems: string[] = [];
      const finalAssistantItems: string[] = [];
      for (let j = i + 1; j < events.length; j++) {
        const candidate = events[j].payload ?? {};
        const nextIsUserMessage = (events[j].type === 'event_msg' && candidate.type === 'user_message')
          || (events[j].type === 'response_item' && candidate.type === 'message' && candidate.role === 'user');
        if (nextIsUserMessage) break;
        if (events[j].type === 'event_msg' && candidate.type === 'agent_message' && typeof candidate.message === 'string') agentMessages.push(candidate.message);
        if (events[j].type === 'response_item' && candidate.type === 'message' && candidate.role === 'assistant') {
          const text = textFromContent(candidate.content);
          assistantItems.push(text);
          if (candidate.phase === 'final_answer') finalAssistantItems.push(text);
        }
      }
      const response = agentMessages.length > 0 ? agentMessages.join('')
        : finalAssistantItems.length > 0 ? finalAssistantItems.join('') : assistantItems.join('');
      entries.push({ prompt, response: response.slice(0, 8000), timestamp: event.timestamp ?? new Date(0).toISOString(), workdir, sessionId });
    }
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    result.promptsFound++;
    onProgress?.(i + 1, result.promptsImported, entries.length, entry.prompt.slice(0, 60));
    if (dryRun) { result.promptsImported++; continue; }
    const rules = dedupFilter.checkRules(entry.prompt);
    if (!rules.keep || !dedupFilter.checkDuplicate(entry.prompt).keep) { result.filtered++; continue; }
    try {
      let metadata: PromptMetadata = {};
      if (analyzer) {
        try { metadata = mergeMetadata({}, await analyzePrompt(entry.prompt, analyzer), false); }
        catch { /* Analysis failure does not prevent importing the transcript. */ }
      }
      const id = db.insert(createCaptureRecord({ timestamp: entry.timestamp, tool: 'codex', prompt: entry.prompt, response: entry.response,
        args: entry.prompt, workdir: entry.workdir, hostname, exit_code: 0, metadata: { ...metadata } }));
      dedupFilter.registerHash(entry.prompt, id);
      result.promptsImported++;
    } catch (error) { result.errors.push(`insert session ${entry.sessionId}: ${(error as Error).message}`); result.skipped++; }
  }
  return result;
}
