import fs from 'fs';
import path from 'path';
import os from 'os';

export interface PhConfig {
  geminiApiKey?: string;
  dbPath?: string;
  analyzeProvider?: 'ollama' | 'gemini'; // default: 'ollama'
  ollamaUrl?: string;                    // default: 'http://localhost:11434'
  ollamaModel?: string;                  // default: 'llama3.1:latest'
  filterMinLength?: number;              // default: 15
  filterMinRelevance?: number;           // default: 3 (0 = disable)
  backgroundAnalysis?: boolean;          // default: false
  ollamaEmbedModel?: string;             // default: nomic-embed-text-v2-moe
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
}
