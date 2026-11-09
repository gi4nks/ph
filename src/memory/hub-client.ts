import { randomUUID } from 'node:crypto';
import type { PhConfig } from '../config/index.js';
import { resolveMemoryHubConfig } from '../config/runtime.js';

export interface HubMemoryInput {
  id?: string;
  content: string;
  scope: 'work' | 'project' | 'personal';
  project?: string;
  kind: string;
  sensitivity?: 'normal' | 'sensitive';
  explicit_sensitive?: boolean;
  source: string;
  source_ref?: string;
}

function hubCredentials(cfg: PhConfig): { base: string; key: string } {
  const { url: base, apiKey: key } = resolveMemoryHubConfig(cfg);
  if (!base || !key) throw new Error('Shared memory hub is not configured.');
  return { base: base.replace(/\/+$/, ''), key };
}

async function request(cfg: PhConfig, route: string, options: { method?: string; body?: unknown } = {}): Promise<Record<string, unknown>> {
  const { base, key } = hubCredentials(cfg);
  const response = await fetch(`${base}${route}`, {
    method: options.method ?? 'GET',
    headers: { Authorization: `Bearer ${key}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : `Memory hub request failed (${response.status}).`);
  return payload;
}

export async function saveHubMemory(cfg: PhConfig, input: HubMemoryInput): Promise<string> {
  const result = await request(cfg, '/api/memories', {
    method: 'POST', body: { ...input, id: input.id ?? randomUUID(), sensitivity: input.sensitivity ?? 'normal' },
  });
  const memory = result.memory as { id?: unknown } | undefined;
  if (!memory || typeof memory.id !== 'string') throw new Error('Memory hub returned an invalid memory record.');
  return memory.id;
}

export async function searchHubMemories(cfg: PhConfig, query: string, scope?: 'work' | 'project' | 'personal', limit = 10, includeSensitive = false, includePersonal = false, project?: string): Promise<Array<Record<string, unknown>>> {
  const result = await request(cfg, '/api/memories/search', {
    method: 'POST', body: { query, scope, limit, include_sensitive: includeSensitive, include_personal: includePersonal, project },
  });
  return Array.isArray(result.memories) ? result.memories as Array<Record<string, unknown>> : [];
}

export async function getHubMemory(cfg: PhConfig, id: string): Promise<Record<string, unknown> | undefined> {
  try {
    const result = await request(cfg, `/api/memories/${encodeURIComponent(id)}`);
    return result.memory as Record<string, unknown> | undefined;
  } catch (error) {
    if ((error as Error).message.includes('memory not found')) return undefined;
    throw error;
  }
}

export async function forgetHubMemory(cfg: PhConfig, id: string): Promise<boolean> {
  const { base, key } = hubCredentials(cfg);
  const response = await fetch(`${base}/api/memories/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Memory hub forget failed (${response.status}).`);
  return true;
}

export async function restoreHubMemory(cfg: PhConfig, id: string): Promise<void> {
  await request(cfg, `/api/memories/${encodeURIComponent(id)}/restore`, { method: 'POST', body: {} });
}
