import type { PhConfig } from './index.js';
type RuntimeEnvironment = typeof process.env;

export interface MemoryHubRuntimeConfig {
  url?: string;
  apiKey?: string;
  configured: boolean;
  partial: boolean;
}

export interface RemoteSyncRuntimeConfig {
  url?: string;
  apiKey?: string;
}

export interface ServerAuthRuntimeConfig {
  historyApiKey?: string;
  memoryHubApiKey?: string;
}

/** Resolve memory-hub environment overrides and file config in one boundary. */
export function resolveMemoryHubConfig(cfg: PhConfig, env: RuntimeEnvironment = process.env): MemoryHubRuntimeConfig {
  const url = env.PH_MEMORY_HUB_URL || cfg.memoryHubUrl || undefined;
  const apiKey = env.PH_MEMORY_HUB_API_KEY || cfg.memoryHubApiKey || undefined;
  return { url, apiKey, configured: Boolean(url && apiKey), partial: Boolean(url) !== Boolean(apiKey) };
}

/** Resolve raw-history sync settings; these credentials remain separate from the memory hub. */
export function resolveRemoteSyncConfig(cfg: PhConfig, env: RuntimeEnvironment = process.env): RemoteSyncRuntimeConfig {
  return {
    url: env.PH_REMOTE_URL || cfg.remoteUrl || undefined,
    apiKey: cfg.remoteApiKey,
  };
}

export function resolveServerAuthConfig(cfg: PhConfig, env: RuntimeEnvironment = process.env): ServerAuthRuntimeConfig {
  return {
    historyApiKey: env.PH_SERVER_API_KEY || cfg.remoteApiKey || undefined,
    memoryHubApiKey: resolveMemoryHubConfig(cfg, env).apiKey,
  };
}
