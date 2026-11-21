import fs from 'node:fs';
import os from 'node:os';
import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { createCaptureRecord } from '../capture/index.js';
import { completeLiveCapture, prepareLiveCapture } from '../capture/lifecycle.js';
import { parseClaudeTranscript } from '../importer/claude.js';
import { parseCodexRollout } from '../importer/codex.js';
import { parseAgyTranscript, resolveFullTranscriptFile } from '../importer/agy.js';
import type { PromptEntry } from '../types.js';
import { captureHash } from '../utils/captureHash.js';
import { parseFlags } from './_utils.js';

interface HookCaptureCandidate {
  tool: string;
  prompt: string;
  response: string;
  workdir: string;
  timestamp?: string;
  args?: string;
  metadata?: Record<string, unknown>;
}

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function resolveCandidateWorkdir(candidate: HookCaptureCandidate, fallbackWorkdir?: string): string {
  const direct = candidate.workdir.trim();
  if (direct) return direct;
  const metaWorkdir = candidate.metadata && typeof candidate.metadata.workdir === 'string'
    ? candidate.metadata.workdir.trim()
    : '';
  return metaWorkdir || fallbackWorkdir || os.homedir();
}

function extractCandidates(
  tool: string,
  payload: Record<string, unknown>,
  workdirFlag?: string,
): HookCaptureCandidate[] {
  switch (tool) {
    case 'claude': {
      const transcriptPath = nonEmptyString(payload.transcript_path);
      if (!transcriptPath || !fs.existsSync(transcriptPath)) return [];
      const parsed = parseClaudeTranscript(transcriptPath);
      const last = parsed.entries[parsed.entries.length - 1];
      if (!last || !last.prompt) return [];
      const workdir = last.workdir || nonEmptyString(payload.cwd) || workdirFlag || os.homedir();
      return [{
        tool: 'claude',
        prompt: last.prompt,
        response: last.response,
        workdir,
        timestamp: last.timestamp,
      }];
    }

    case 'gemini': {
      const prompt = nonEmptyString(payload.prompt);
      if (!prompt) return [];
      const response = typeof payload.prompt_response === 'string' ? payload.prompt_response : '';
      const workdir = nonEmptyString(payload.cwd) || workdirFlag || os.homedir();
      const timestamp = nonEmptyString(payload.timestamp) || undefined;
      return [{ tool: 'gemini', prompt, response, workdir, timestamp }];
    }

    case 'codex': {
      const transcriptPath = nonEmptyString(payload.transcript_path);
      if (!transcriptPath || !fs.existsSync(transcriptPath)) return [];
      const parsed = parseCodexRollout(transcriptPath, workdirFlag);
      return parsed.entries.map((entry) => ({
        tool: 'codex',
        prompt: entry.prompt,
        response: entry.response,
        workdir: entry.workdir || workdirFlag || os.homedir(),
        timestamp: entry.timestamp,
        args: entry.prompt,
      }));
    }

    case 'agy':
    case 'antigravity': {
      const rawPath = nonEmptyString(payload.transcriptPath) || nonEmptyString(payload.transcript_path);
      if (!rawPath) return [];
      const resolvedPath = resolveFullTranscriptFile(rawPath);
      if (!fs.existsSync(resolvedPath)) return [];
      const workspacePath = Array.isArray(payload.workspacePaths) ? nonEmptyString(payload.workspacePaths[0]) : '';
      const explicitWorkdir = workspacePath || nonEmptyString(payload.cwd) || workdirFlag || undefined;
      const parsed = parseAgyTranscript(resolvedPath, explicitWorkdir);
      return parsed.interactions.map((item) => ({
        tool: 'agy',
        prompt: item.prompt,
        response: item.response,
        workdir: item.workdir || explicitWorkdir || os.homedir(),
        timestamp: item.timestamp,
        args: item.prompt,
        metadata: item.toolCalls.length > 0 ? { tool_calls: item.toolCalls } : undefined,
      }));
    }

    default:
      return [];
  }
}

/** Unified hook entry point for Claude Code, Codex CLI, Gemini CLI, and Antigravity. */
export async function cmdHook(
  dbPath: string,
  cfg: PhConfig,
  args: string[],
  stdinOverride?: string,
): Promise<void> {
  try {
    const { flags, positional } = parseFlags(args);
    const tool = positional[0]?.toLowerCase() ?? '';
    if (!tool) return;
    const workdirFlag = typeof flags.workdir === 'string' && flags.workdir.trim()
      ? flags.workdir.trim()
      : undefined;

    const raw = (stdinOverride !== undefined ? stdinOverride : await readStdinText()).trim();
    if (!raw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;

    const candidates = extractCandidates(tool, parsed as Record<string, unknown>, workdirFlag);
    if (candidates.length === 0) return;

    const seenHashes = new Set<string>();
    const insertedIds: number[] = [];
    let lastInsertedRecord: Omit<PromptEntry, 'id'> | undefined;

    const db = new PhDB(dbPath);
    try {
      for (const candidate of candidates) {
        const prompt = candidate.prompt.trim();
        if (!prompt) continue;
        const turnWorkdir = resolveCandidateWorkdir(candidate, workdirFlag);
        const capHash = captureHash({
          tool: candidate.tool,
          workdir: turnWorkdir,
          prompt,
          response: candidate.response,
        });
        if (seenHashes.has(capHash)) continue;
        if (db.getPromptIdByCaptureHash(capHash) !== undefined) {
          seenHashes.add(capHash);
          continue;
        }
        const record = createCaptureRecord({
          tool: candidate.tool,
          prompt,
          response: candidate.response,
          args: candidate.args ?? '',
          workdir: turnWorkdir,
          timestamp: candidate.timestamp,
          metadata: candidate.metadata,
        });
        const id = db.insert(record);
        seenHashes.add(capHash);
        insertedIds.push(id);
        lastInsertedRecord = record;
      }

      if (insertedIds.length > 0 && lastInsertedRecord) {
        const lastId = insertedIds[insertedIds.length - 1];
        const prepared = prepareLiveCapture(lastInsertedRecord, cfg);
        db.updateMetadata(lastId, prepared.metadata);
      }
    } finally {
      db.close();
    }

    if (insertedIds.length > 0) {
      await completeLiveCapture(dbPath, cfg, insertedIds[insertedIds.length - 1]);
    }
  } catch {
    // Hooks must never throw or exit non-zero so AI CLIs are never disrupted.
  }
}
