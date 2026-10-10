import fs from 'fs';
import path from 'path';
import os from 'os';

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
  remoteLastPush?: string;               // ISO timestamp of last successful push
  remoteLastPull?: string;               // ISO timestamp of last successful pull
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
