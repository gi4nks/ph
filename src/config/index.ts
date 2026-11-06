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
  analyzeProvider?: 'ollama' | 'gemini' | 'openrouter' | 'mlx-serve'; // default: 'ollama'
  ollamaUrl?: string;                    // default: 'http://localhost:11434'
  ollamaModel?: string;                  // default: 'llama3.1:latest'
  openrouterModel?: string;              // OpenRouter model ID, e.g. provider/model
  openrouterUrl?: string;                // default: https://openrouter.ai/api/v1
  openrouterApiKey?: string;             // overridden by OPENROUTER_API_KEY
  mlxServeModel?: string;                // exact model ID returned by MLX-Serve
  mlxServeUrl?: string;                  // default: http://127.0.0.1:11234/v1 (SSH tunnel)
  mlxServeApiKey?: string;               // overridden by MLX_SERVE_API_KEY / GLB_OMLX_API_KEY
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
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as PhConfig;
    }
  } catch (_) {
    // ignore parse errors, return empty config
  }
  return {};
}

export function save(cfg: PhConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
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
