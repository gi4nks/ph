import { createHash } from 'crypto';
import type { AnalysisResult } from '../analyzer/index.js';

export type FilterReason =
  | 'too_short'
  | 'pattern_match'
  | 'non_printable'
  | 'exact_duplicate'
  | 'low_relevance';

export interface FilterResult {
  keep: boolean;
  reason?: FilterReason;
  details?: string;
}

export interface FilterOptions {
  minLength?: number;           // default: 15
  minRelevance?: number;        // default: 3 (0 = disable LLM scoring check)
  existingHashes?: Map<string, number>; // for exact dedup
}

// Patterns that indicate trivial/useless prompts (conversational filler)
const TRIVIAL_PATTERN =
  /^(yes|no|ok|okay|sure|thanks|thank you|continue|go on|next|exit|quit|stop|help|y|n|👍|👎|che dici\??|dimmi|vai|go|do it|tell me|vadi|procedi|aspetta|wait|[.!?,;:]+|\s*)$/i;

// Fragments that look like orphan code or syntax noise
const ORPHAN_CODE_PATTERN = /^([{}()[\]<>|&!=\-+*/%^~#@\\:;.,\s]+|\.\.\.|console\.log.*|print.*)$/i;

// Non-printable / PTY noise: only control chars and escape sequences
// eslint-disable-next-line no-control-regex
const NON_PRINTABLE_PATTERN = /^[\x00-\x1f\x7f\x1b[\]()#;\d;A-Za-z]*$/;

export class FilterPipeline {
  private readonly minLength: number;
  private readonly minRelevance: number;
  private readonly existingHashes: Map<string, number>;

  constructor(opts: FilterOptions = {}) {
    this.minLength = opts.minLength ?? 15;
    this.minRelevance = opts.minRelevance ?? 3;
    this.existingHashes = opts.existingHashes ?? new Map();
  }

  static hashPrompt(text: string): string {
    return createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
  }

  checkRules(text: string): FilterResult {
    const trimmed = text.trim();

    // Too short
    if (trimmed.length < this.minLength) {
      return { keep: false, reason: 'too_short', details: `length ${trimmed.length} < ${this.minLength}` };
    }

    // Non-printable / PTY noise
    if (NON_PRINTABLE_PATTERN.test(trimmed)) {
      return { keep: false, reason: 'non_printable', details: 'only control characters' };
    }

    // Trivial pattern match (filler)
    if (TRIVIAL_PATTERN.test(trimmed)) {
      return { keep: false, reason: 'pattern_match', details: `matches trivial pattern: "${trimmed}"` };
    }

    // Orphan code or syntax noise
    if (ORPHAN_CODE_PATTERN.test(trimmed)) {
      return { keep: false, reason: 'pattern_match', details: `matches orphan code pattern: "${trimmed}"` };
    }

    return { keep: true };
  }

  checkDuplicate(text: string): FilterResult {
    const hash = FilterPipeline.hashPrompt(text);
    if (this.existingHashes.has(hash)) {
      const existingId = this.existingHashes.get(hash);
      return { keep: false, reason: 'exact_duplicate', details: `duplicate of #${existingId}` };
    }
    return { keep: true };
  }

  /**
   * Register a prompt hash after a successful insert to catch duplicates within the same batch.
   */
  registerHash(text: string, id: number): void {
    const hash = FilterPipeline.hashPrompt(text);
    this.existingHashes.set(hash, id);
  }

  checkRelevance(result: AnalysisResult): FilterResult {
    if (this.minRelevance <= 0) return { keep: true };
    if (result.relevance === undefined) return { keep: true };
    if (result.relevance < this.minRelevance) {
      return {
        keep: false,
        reason: 'low_relevance',
        details: `relevance ${result.relevance} < ${this.minRelevance}`,
      };
    }
    return { keep: true };
  }

  /**
   * Full pipeline check: rules → dedup → (relevance if provided).
   * Short-circuits on first failure.
   */
  check(text: string, analysisResult?: AnalysisResult): FilterResult {
    const rulesResult = this.checkRules(text);
    if (!rulesResult.keep) return rulesResult;

    const dupResult = this.checkDuplicate(text);
    if (!dupResult.keep) return dupResult;

    if (analysisResult !== undefined) {
      const relResult = this.checkRelevance(analysisResult);
      if (!relResult.keep) return relResult;
    }

    return { keep: true };
  }
}
