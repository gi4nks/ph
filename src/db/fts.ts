/**
 * Helpers that turn free-form user text into safe FTS5 MATCH expressions.
 * Every token is quoted, so FTS5 operators typed by the user are never parsed.
 */

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'does', 'for', 'from',
  'how', 'i', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to',
  'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'with',
  'che', 'chi', 'come', 'con', 'cosa', 'da', 'dei', 'del', 'della', 'delle',
  'di', 'dove', 'e', 'il', 'la', 'le', 'lo', 'ma', 'nel', 'non', 'per',
  'quale', 'sono', 'su', 'tra', 'un', 'una',
]);

export function tokenize(raw: string): string[] {
  return (raw.match(/[\p{L}\p{N}_]+/gu) ?? []).filter(token => token.length > 0);
}

/**
 * Build an FTS5 expression.
 * - `AND` keeps every token (precise; default for interactive search).
 * - `OR` drops stop words and one-letter tokens (broad recall for task queries).
 */
export function buildFtsTermsQuery(raw: string, operator: 'AND' | 'OR' = 'AND'): string | null {
  const tokens = tokenize(raw);
  if (tokens.length === 0) return null;
  const filtered = operator === 'OR'
    ? tokens.filter(token => token.length > 1 && !STOP_WORDS.has(token.toLowerCase()))
    : tokens;
  const chosen = filtered.length > 0 ? filtered : tokens;
  return chosen.map(token => `"${token.replace(/"/g, '""')}"`).join(` ${operator} `);
}

/** Reciprocal-rank fusion over ranked ID lists (k = 60, the conventional constant). */
export function reciprocalRankFusion(lists: number[][], k = 60): number[] {
  const scores = new Map<number, number>();
  for (const list of lists) {
    list.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1)));
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
