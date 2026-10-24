import { createHash } from 'node:crypto';
import type { PromptEntry } from '../types.js';

export const SYNC_PAGE_SIZE = 500;
export const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;

export interface SyncCursor {
  target: string;
  databaseId: string;
  id: number;
}

export interface SyncPushResponse {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface SyncPullResponse {
  prompts: PromptEntry[];
  hasMore: boolean;
  nextCursor: number;
}

/** Parse only absolute HTTP(S) endpoints accepted by fetch. */
export function parseRemoteUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Remote URL must be an absolute HTTP or HTTPS URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Remote URL must use HTTP or HTTPS.');
  }
  if (!parsed.hostname) throw new Error('Remote URL must include a host.');
  return parsed;
}

/** Target identity excludes credentials/query parameters so secrets are never persisted in the cursor. */
export function syncTarget(url: string): string {
  const parsed = parseRemoteUrl(url);
  const canonical = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, '')}`;
  return createHash('sha256').update(canonical).digest('hex');
}

export function parseSyncPushResponse(value: unknown): SyncPushResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Remote server returned an invalid push response.');
  }
  const result = value as Partial<SyncPushResponse>;
  if (!Number.isInteger(result.imported) || result.imported! < 0 || !Number.isInteger(result.skipped) || result.skipped! < 0 || !Array.isArray(result.errors)) {
    throw new Error('Remote server returned an invalid push response.');
  }
  if (result.errors.some(error => typeof error !== 'string')) {
    throw new Error('Remote server returned an invalid push response.');
  }
  return result as SyncPushResponse;
}

export function parseSyncPullResponse(value: unknown): SyncPullResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Remote server does not support cursor-based sync; upgrade the remote PH server.');
  }
  const result = value as Partial<SyncPullResponse>;
  if (!Array.isArray(result.prompts) || typeof result.hasMore !== 'boolean' || !Number.isInteger(result.nextCursor) || result.nextCursor! < 0) {
    throw new Error('Remote server does not support cursor-based sync; upgrade the remote PH server.');
  }
  if (result.prompts.some(prompt => !prompt || !Number.isInteger(prompt.id) || prompt.id < 1)) {
    throw new Error('Remote server returned an invalid sync page.');
  }
  return result as SyncPullResponse;
}
