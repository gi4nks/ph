import type { LLMProvider } from '../ai/provider.js';
import type { PhDB } from '../db/index.js';
import type { PromptEntry, PromptMetadata } from '../types.js';

export interface AnalysisResult {
  project?: string;
  language?: string;
  role?: string;
  tags?: string[];
  relevance?: number;  // 0-10: how useful/informative this prompt is for future reference
  quality?: number;    // 0-10: how well-structured, detailed and clear the prompt is
}

const ANALYSIS_PROMPT = (text: string) => `\
Analyze this AI tool prompt and return ONLY a JSON object with these exact fields:
{
  "project": "<project name if clearly identifiable, else empty string>",
  "language": "<programming language if identifiable, else empty string>",
  "role": "<ONE of: debug, refactor, explain, review, architect, test, docs, generate, research — or empty string>",
  "tags": ["<tag1>", "<tag2>"],
  "relevance": <integer 0-10>,
  "quality": <integer 0-10>
}

Rules:
- tags: 1-3 short lowercase words describing what the prompt is about
- role: pick the single best match, or "" if none fits
- project/language: only fill if clearly inferrable from the prompt text
- relevance: how informative/useful is this prompt for future reference?
  0=completely useless (single word, greeting, yes/no), 5=average technical question, 10=highly detailed technical question
- quality: how well-structured is the prompt?
  0=messy/vague, 5=clear but simple, 10=professional prompt engineering (context, instructions, examples, constraints)
- Return ONLY the JSON object — no markdown fences, no explanation, no other text

Prompt to analyze:
"""
${text.slice(0, 1500)}
"""`;

/**
 * Parses LLM output to extract AnalysisResult.
 * Handles markdown fences, leading/trailing text, malformed JSON gracefully.
 */
export function parseAnalysisResponse(raw: string): AnalysisResult {
  // Strip markdown code fences
  let cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

  // Find the first { ... } block
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return {};

  cleaned = cleaned.slice(start, end + 1);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {};
  }

  const result: AnalysisResult = {};

  if (typeof parsed['project'] === 'string' && parsed['project'].trim()) {
    result.project = parsed['project'].trim();
  }
  if (typeof parsed['language'] === 'string' && parsed['language'].trim()) {
    result.language = parsed['language'].trim().toLowerCase();
  }
  if (typeof parsed['role'] === 'string' && parsed['role'].trim()) {
    const validRoles = ['debug', 'refactor', 'explain', 'review', 'architect', 'test', 'docs', 'generate', 'research'];
    const role = parsed['role'].trim().toLowerCase();
    if (validRoles.includes(role)) result.role = role;
  }
  if (Array.isArray(parsed['tags'])) {
    const tags = (parsed['tags'] as unknown[])
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .map(t => t.trim().toLowerCase())
      .slice(0, 5);
    if (tags.length > 0) result.tags = tags;
  }
  if (typeof parsed['relevance'] === 'number') {
    result.relevance = Math.max(0, Math.min(10, Math.round(parsed['relevance'])));
  }
  if (typeof parsed['quality'] === 'number') {
    result.quality = Math.max(0, Math.min(10, Math.round(parsed['quality'])));
  }

  return result;
}

/**
 * Analyze a single prompt text using the given LLM provider.
 * Returns empty object on any error (never throws).
 */
export async function analyzePrompt(text: string, provider: LLMProvider): Promise<AnalysisResult> {
  try {
    const raw = await provider.generate(ANALYSIS_PROMPT(text));
    return parseAnalysisResponse(raw);
  } catch {
    return {};
  }
}

/**
 * Merge new analysis result into existing metadata, preserving manually-set fields.
 * Manual fields (starred, project set by user) take precedence only if force=false.
 */
export function mergeMetadata(
  existing: PromptMetadata,
  result: AnalysisResult,
  force: boolean
): PromptMetadata {
  const merged: PromptMetadata = { ...existing };
  if (force || !merged.project)  merged.project  = result.project  || merged.project;
  if (force || !merged.language) merged.language = result.language || merged.language;
  if (force || !merged.role)     merged.role     = result.role     || merged.role;
  if (force || !merged.tags?.length) merged.tags = result.tags    ?? merged.tags;
  if (result.relevance !== undefined && (force || merged.relevance === undefined)) {
    merged.relevance = result.relevance;
  }
  if (result.quality !== undefined && (force || merged.quality === undefined)) {
    merged.quality = result.quality;
  }
  // Clean up empty strings set by LLM
  if (!merged.project)  delete merged.project;
  if (!merged.language) delete merged.language;
  if (!merged.role)     delete merged.role;
  if (!merged.tags?.length) delete merged.tags;
  return merged;
}

function parseMeta(raw: string): PromptMetadata {
  try { return JSON.parse(raw) as PromptMetadata; } catch { return {}; }
}

function hasMetadata(entry: PromptEntry): boolean {
  const meta = parseMeta(entry.metadata);
  return Boolean(meta.role || meta.tags?.length || meta.project || meta.language);
}

export interface AnalyzeAllOpts {
  force?: boolean;
  pruneBelow?: number;   // delete entries with relevance < this value (0 = disable)
  dryRun?: boolean;      // if true, don't actually delete
  onProgress?: (done: number, total: number, entry: PromptEntry, result: AnalysisResult | null, err?: string) => void;
  onPrune?: (entry: PromptEntry, relevance: number) => void;
}

export interface AnalyzeAllResult {
  updated: number;
  skipped: number;
  failed: number;
  pruned: number;
}

/**
 * Analyze all (or untagged) prompts sequentially and persist metadata to DB.
 * force=false → skip entries that already have metadata
 * force=true  → reanalyze everything
 */
export async function analyzeAll(
  entries: PromptEntry[],
  provider: LLMProvider,
  db: PhDB,
  opts: AnalyzeAllOpts = {}
): Promise<AnalyzeAllResult> {
  const { force = false, pruneBelow = 0, dryRun = false, onProgress, onPrune } = opts;

  const toProcess = force ? entries : entries.filter(e => !hasMetadata(e));
  const stats: AnalyzeAllResult = { updated: 0, skipped: entries.length - toProcess.length, failed: 0, pruned: 0 };

  for (let i = 0; i < toProcess.length; i++) {
    const entry = toProcess[i];
    let result: AnalysisResult | null = null;
    let errMsg: string | undefined;

    try {
      result = await analyzePrompt(entry.prompt, provider);
      const existing = parseMeta(entry.metadata);
      const merged = mergeMetadata(existing, result, force);

      // Prune if relevance is below threshold
      if (pruneBelow > 0 && result.relevance !== undefined && result.relevance < pruneBelow) {
        onPrune?.(entry, result.relevance);
        if (!dryRun) {
          db.deleteById(entry.id);
        }
        stats.pruned++;
      } else {
        db.updateMetadata(entry.id, JSON.stringify(merged));
        stats.updated++;
      }
    } catch (e: unknown) {
      errMsg = (e as Error).message;
      stats.failed++;
    }

    onProgress?.(i + 1, toProcess.length, entry, result, errMsg);
  }

  return stats;
}
