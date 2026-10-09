import { createHash } from 'crypto';

/**
 * Shared sync dedup key (SPEC-010).
 * Previously duplicated as inline sha256 in server/index.ts and
 * commands/remote.ts (SPEC-ISSUES-012): the two copies could drift.
 *
 * Backward compatible (SPEC-ISSUES-012): entries WITHOUT args hash exactly as
 * the legacy `tool|prompt|response` format, so existing sync_hash values are
 * preserved and nothing is re-pushed. Entries WITH args include them — two runs
 * of the same tool+prompt with different args are distinct interactions and
 * must NOT collapse on pull.
 */
export function syncHash(entry: { tool: string; prompt: string; response: string; args?: string }): string {
  const body = entry.args
    ? `${entry.tool}|${entry.prompt}|${entry.response}|${entry.args}`
    : `${entry.tool}|${entry.prompt}|${entry.response}`;
  return createHash('sha256').update(body).digest('hex');
}
