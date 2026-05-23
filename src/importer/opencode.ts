import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { PhDB } from '../db/index.js';
import type { LLMProvider } from '../ai/provider.js';
import { analyzePrompt, mergeMetadata } from '../analyzer/index.js';
import type { FilterPipeline } from '../filter/index.js';
import type { ImportResult } from '../types.js';

const MAX_RESPONSE_LENGTH = 8000;
const TRUNCATION_SUFFIX = '\n... (truncated)';

interface OCMessageData {
  role: 'user' | 'assistant';
  time: { created: number; completed?: number };
  summary?: { title?: string; diffs?: unknown[] };
  parentID?: string;
  agent?: string;
  model?: { providerID?: string; modelID?: string };
  modelID?: string;
  providerID?: string;
  mode?: string;
  path?: { cwd?: string; root?: string };
  tokens?: { input?: number; output?: number; reasoning?: number };
  finish?: string;
}

interface OCPartData {
  type: string;
  text?: string;
}

function truncateResponse(text: string): string {
  if (text.length <= MAX_RESPONSE_LENGTH) return text;
  return text.slice(0, MAX_RESPONSE_LENGTH - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}

export async function importOpenCodeHistory(
  db: PhDB,
  opencodeDir: string,
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

  const dbPath = path.join(opencodeDir, '..', 'opencode.db');
  if (!fs.existsSync(dbPath)) {
    result.errors.push(`opencode database not found at ${dbPath}`);
    return result;
  }

  let ocDb: Database.Database;
  try {
    ocDb = new Database(dbPath, { readonly: true });
  } catch (e: unknown) {
    result.errors.push(`cannot open opencode database: ${(e as Error).message}`);
    return result;
  }

  result.filesScanned = 1;

  const hostname = os.hostname();

  interface PendingEntry {
    prompt: string;
    response: string;
    timestamp: string;
    workdir: string;
    sessionId: string;
    agent?: string;
    modelInfo?: string;
    tokens?: string;
    title?: string;
  }

  const pendingEntries: PendingEntry[] = [];

  try {
    const sessions = ocDb.prepare(
      `SELECT id, directory, time_created FROM session ORDER BY time_created`
    ).all() as { id: string; directory: string; time_created: number }[];

    const getMessages = ocDb.prepare(
      `SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created, id`
    );

    const getParts = ocDb.prepare(
      `SELECT data FROM part WHERE message_id = ? ORDER BY id`
    );

    function getTextContent(messageId: string): string {
      const partRows = getParts.all(messageId) as { data: string }[];
      const texts: string[] = [];
      for (const row of partRows) {
        try {
          const partData = JSON.parse(row.data) as OCPartData;
          if (partData.type === 'text' && partData.text) {
            texts.push(partData.text);
          }
        } catch { /* skip unparseable parts */ }
      }
      return texts.join('');
    }

    for (const session of sessions) {
      const messageRows = getMessages.all(session.id) as { id: string; data: string; time_created: number }[];
      if (messageRows.length === 0) continue;

      const messages: { id: string; data: OCMessageData; time_created: number }[] = [];
      for (const row of messageRows) {
        try {
          const data = JSON.parse(row.data) as OCMessageData;
          messages.push({ id: row.id, data, time_created: row.time_created });
        } catch { /* skip */ }
      }

      const assistantByParent = new Map<string, { id: string; data: OCMessageData }>();
      for (const msg of messages) {
        if (msg.data.role === 'assistant' && msg.data.parentID) {
          assistantByParent.set(msg.data.parentID, { id: msg.id, data: msg.data });
        }
      }

      for (const msg of messages) {
        if (msg.data.role !== 'user') continue;

        const prompt = getTextContent(msg.id);
        if (!prompt.trim()) continue;

        const assistant = assistantByParent.get(msg.id);
        let response = '';
        if (assistant) {
          const rawText = getTextContent(assistant.id);
          if (rawText) response = truncateResponse(rawText);
        }

        const timestamp = new Date(msg.data.time.created).toISOString();
        const workdir = session.directory || '';

        pendingEntries.push({
          prompt: prompt.trim(),
          response,
          timestamp,
          workdir,
          sessionId: session.id,
          agent: msg.data.agent || assistant?.data?.mode,
          modelInfo: msg.data.model ? JSON.stringify(msg.data.model) :
            (assistant?.data?.providerID ? JSON.stringify({ providerID: assistant.data.providerID, modelID: assistant.data.modelID }) : undefined),
          tokens: assistant?.data?.tokens ? JSON.stringify(assistant.data.tokens) : undefined,
          title: msg.data.summary?.title,
        });
      }
    }
  } finally {
    ocDb.close();
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

    if (filter) {
      const preCheck = filter.checkRules(entry.prompt);
      if (!preCheck.keep) { result.filtered++; continue; }
      const dupCheck = filter.checkDuplicate(entry.prompt);
      if (!dupCheck.keep) { result.filtered++; continue; }
    }

    try {
      let metadata: Record<string, unknown> = {};

      if (analyzer) {
        try {
          const analysis = await analyzePrompt(entry.prompt, analyzer);
          if (filter && analysis) {
            const relCheck = filter.checkRelevance(analysis);
            if (!relCheck.keep) { result.filtered++; continue; }
          }
          const merged = mergeMetadata({}, analysis, false);
          if (Object.keys(merged).length > 0) metadata = { ...merged };
        } catch { /* analysis failure is non-fatal */ }
      }

      if (entry.title) metadata.title = entry.title;
      if (entry.agent) metadata.agent = entry.agent;
      if (entry.modelInfo && entry.modelInfo !== '{}') {
        try { metadata.model = JSON.parse(entry.modelInfo); } catch { metadata.model = entry.modelInfo; }
      }
      if (entry.tokens) {
        try { metadata.tokens = JSON.parse(entry.tokens); } catch { metadata.tokens = entry.tokens; }
      }

      const id = db.insert({
        timestamp: entry.timestamp,
        tool: 'opencode',
        prompt: entry.prompt,
        response: entry.response,
        args: entry.prompt,
        workdir: entry.workdir,
        hostname,
        exit_code: 0,
        metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : '{}',
      });
      filter?.registerHash(entry.prompt, id);
      result.promptsImported++;
    } catch (e: unknown) {
      result.errors.push(`insert session ${entry.sessionId}: ${(e as Error).message}`);
      result.skipped++;
    }
  }

  return result;
}
