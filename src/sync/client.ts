import type { PromptEntry } from '../types.js';
import { MAX_REQUEST_BODY_BYTES, parseSyncPushResponse } from './protocol.js';

export interface SyncPushOptions {
  timeoutMs?: number;
  maxBodyBytes?: number;
}

export function splitSyncPushPages(prompts: PromptEntry[], maxBodyBytes = MAX_REQUEST_BODY_BYTES): PromptEntry[][] {
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) throw new Error('Sync request body limit must be a positive integer.');
  const pages: PromptEntry[][] = [];
  let current: PromptEntry[] = [];
  const wrapperBytes = Buffer.byteLength('{"prompts":[]}', 'utf8');
  let currentBytes = wrapperBytes;

  for (const prompt of prompts) {
    const encoded = JSON.stringify(prompt);
    const promptBytes = Buffer.byteLength(encoded, 'utf8');
    const additionalBytes = promptBytes + (current.length ? 1 : 0);
    if (wrapperBytes + promptBytes > maxBodyBytes) {
      throw new Error(`Interaction #${prompt.id} exceeds the remote request body limit (${maxBodyBytes} bytes).`);
    }
    if (current.length && currentBytes + additionalBytes > maxBodyBytes) {
      pages.push(current);
      current = [];
      currentBytes = wrapperBytes;
    }
    current.push(prompt);
    currentBytes += promptBytes + (current.length > 1 ? 1 : 0);
  }

  if (current.length) pages.push(current);
  return pages;
}

export async function sendSyncPushPage(url: string, apiKey: string | undefined, prompts: PromptEntry[], options: SyncPushOptions = {}): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const totals = { imported: 0, skipped: 0, errors: [] as string[] };
  for (const page of splitSyncPushPages(prompts, options.maxBodyBytes)) {
    const res = await fetch(`${url}/api/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
      body: JSON.stringify({ prompts: page }),
    });
    if (!res.ok) throw new Error(`Remote error ${res.status}: ${await res.text()}`);
    const result = parseSyncPushResponse(await res.json());
    totals.imported += result.imported;
    totals.skipped += result.skipped;
    totals.errors.push(...result.errors);
  }
  return totals;
}
