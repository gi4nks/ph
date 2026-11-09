import fs from 'fs';
import path from 'path';
import os from 'os';

export interface RemoteSyncTargetState {
  remoteDatabaseId?: string;
  pushCursor?: number;
  pullCursor?: number;
  lastPush?: string;
  lastPull?: string;
}

export interface PhConfig {
  geminiApiKey?: string;
  dbPath?: string;
  analyzeProvider?: 'ollama' | 'gemini' | 'openrouter' | 'omlx' | 'mlx-serve'; // default: 'ollama'; mlx-serve is a legacy alias
  ollamaUrl?: string;                    // default: 'http://127.0.0.1:8000'
  ollamaModel?: string;                  // default: 'qwen3.5:9b-mlx'
  openrouterModel?: string;              // OpenRouter model ID, e.g. provider/model
  openrouterUrl?: string;                // default: https://openrouter.ai/api/v1
  openrouterApiKey?: string;             // overridden by OPENROUTER_API_KEY
  omlxModel?: string;                    // exact model ID returned by oMLX
  omlxUrl?: string;                      // default: http://parmenide:8000/v1
  omlxApiKey?: string;                   // overridden by OMLX_API_KEY / MLX_SERVE_API_KEY / GLB_OMLX_API_KEY
  /** @deprecated Use omlxModel. Retained for existing config files and callers. */
  mlxServeModel?: string;
  /** @deprecated Use omlxUrl. Retained for existing config files and callers. */
  mlxServeUrl?: string;
  /** @deprecated Use omlxApiKey. Retained for existing config files and callers. */
  mlxServeApiKey?: string;
  filterMinLength?: number;              // default: 15
  filterMinRelevance?: number;           // default: 3 (0 = disable)
  backgroundAnalysis?: boolean;          // default: false
  ollamaEmbedModel?: string;             // default: nomic-embed-text-v2-moe
  remoteUrl?: string;                    // HTTP URL of remote ph server (or set PH_REMOTE_URL env)
  remoteApiKey?: string;                 // optional API key for remote server
  memoryHubUrl?: string;                 // shared memory service; separate from transcript sync
  memoryHubApiKey?: string;              // bearer key for shared memory service
  memoryAutoCapture?: boolean;           // capture durable work memories when hub and inference are configured
  remoteSyncState?: Record<string, RemoteSyncTargetState>;
  remoteLastPush?: string;               // ISO timestamp of last successful push
  remoteLastPull?: string;               // ISO timestamp of last successful pull
  remotePushCursor?: { target: string; databaseId: string; id: number };
  remotePullCursor?: { target: string; databaseId: string; id: number };
  retentionDays?: number;              // default: 90 — auto-archive prompts older than N days
  retentionMinStarred?: boolean;       // default: true — never archive starred prompts
  retentionMinAnalyzed?: boolean;      // default: true — never archive analyzed prompts (has summary or role)
  retentionMinRelevance?: number;      // default: 3 — prompts below this relevance are archived first
}

const CONFIG_PATH = path.join(os.homedir(), '.ph_config.json');

export function load(): PhConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as PhConfig;
      cfg.omlxModel ??= cfg.mlxServeModel;
      cfg.omlxUrl ??= cfg.mlxServeUrl;
      cfg.omlxApiKey ??= cfg.mlxServeApiKey;
      if (cfg.analyzeProvider === 'mlx-serve') cfg.analyzeProvider = 'omlx';
      return cfg;
    }
  } catch (_) {
    // ignore parse errors, return empty config
  }
  return {};
}

export function save(cfg: PhConfig): void {
  const canonical: PhConfig = { ...cfg };
  canonical.omlxModel ??= canonical.mlxServeModel;
  canonical.omlxUrl ??= canonical.mlxServeUrl;
  canonical.omlxApiKey ??= canonical.mlxServeApiKey;
  if (canonical.analyzeProvider === 'mlx-serve') canonical.analyzeProvider = 'omlx';
  delete canonical.mlxServeModel;
  delete canonical.mlxServeUrl;
  delete canonical.mlxServeApiKey;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(canonical, null, 2), { mode: 0o600 });
  fs.chmodSync(CONFIG_PATH, 0o600);
}

export function getRemoteSyncScopeKey(target: string, localDatabaseId: string): string {
  return `${target}::${localDatabaseId}`;
}

export function getRemoteTargetState(cfg: PhConfig, target: string, localDatabaseId: string): RemoteSyncTargetState {
  const key = getRemoteSyncScopeKey(target, localDatabaseId);
  if (cfg.remoteSyncState?.[key]) {
    return cfg.remoteSyncState[key];
  }
  const pushMatch = cfg.remotePushCursor?.target === target && cfg.remotePushCursor.databaseId === localDatabaseId;
  const pullMatch = cfg.remotePullCursor?.target === target && cfg.remotePullCursor.databaseId === localDatabaseId;
  return {
    pushCursor: pushMatch ? cfg.remotePushCursor?.id : 0,
    pullCursor: pullMatch ? cfg.remotePullCursor?.id : 0,
    lastPush: pushMatch ? cfg.remoteLastPush : undefined,
    lastPull: pullMatch ? cfg.remoteLastPull : undefined,
  };
}

export function setRemoteTargetState(
  cfg: PhConfig,
  target: string,
  localDatabaseId: string,
  updates: Partial<RemoteSyncTargetState>,
): void {
  const key = getRemoteSyncScopeKey(target, localDatabaseId);
  cfg.remoteSyncState = cfg.remoteSyncState ?? {};
  const current = getRemoteTargetState(cfg, target, localDatabaseId);
  const next: RemoteSyncTargetState = {
    ...current,
    ...updates,
  };
  cfg.remoteSyncState[key] = next;

  if (next.pushCursor !== undefined) {
    cfg.remotePushCursor = { target, databaseId: localDatabaseId, id: next.pushCursor };
  }
  if (next.pullCursor !== undefined) {
    cfg.remotePullCursor = { target, databaseId: localDatabaseId, id: next.pullCursor };
  }
  if (next.lastPush !== undefined) cfg.remoteLastPush = next.lastPush;
  if (next.lastPull !== undefined) cfg.remoteLastPull = next.lastPull;
}
