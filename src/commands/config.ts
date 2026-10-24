import { load as loadConfig, save as saveConfig } from '../config/index.js';
import { formatProviderSummary, getProviderSummaries } from '../config/provider-summary.js';
import { parseRemoteUrl } from '../sync/protocol.js';

const SECRET_KEYS = new Set([
  'gemini-api-key',
  'openrouter-api-key',
  'mlx-serve-api-key',
  'remote-api-key',
]);

const KEY_ALIASES: Record<string, string> = {
  geminiApiKey: 'gemini-api-key',
  'gemini-api-key': 'gemini-api-key',
  dbPath: 'db-path',
  'db-path': 'db-path',
  analyzeProvider: 'analyze-provider',
  'analyze-provider': 'analyze-provider',
  ollamaUrl: 'ollama-url',
  'ollama-url': 'ollama-url',
  ollamaModel: 'ollama-model',
  'ollama-model': 'ollama-model',
  openrouterModel: 'openrouter-model',
  'openrouter-model': 'openrouter-model',
  openrouterUrl: 'openrouter-url',
  'openrouter-url': 'openrouter-url',
  openrouterApiKey: 'openrouter-api-key',
  'openrouter-api-key': 'openrouter-api-key',
  mlxServeModel: 'mlx-serve-model',
  'mlx-serve-model': 'mlx-serve-model',
  mlxServeUrl: 'mlx-serve-url',
  'mlx-serve-url': 'mlx-serve-url',
  mlxServeApiKey: 'mlx-serve-api-key',
  'mlx-serve-api-key': 'mlx-serve-api-key',
  ollamaEmbedModel: 'ollama-embed-model',
  'ollama-embed-model': 'ollama-embed-model',
  filterMinLength: 'filter-min-length',
  'filter-min-length': 'filter-min-length',
  filterMinRelevance: 'filter-min-relevance',
  'filter-min-relevance': 'filter-min-relevance',
  backgroundAnalysis: 'background-analysis',
  'background-analysis': 'background-analysis',
  retentionDays: 'retention-days',
  'retention-days': 'retention-days',
  retentionMinRelevance: 'retention-min-relevance',
  'retention-min-relevance': 'retention-min-relevance',
  retentionMinStarred: 'retention-min-starred',
  'retention-min-starred': 'retention-min-starred',
  retentionMinAnalyzed: 'retention-min-analyzed',
  'retention-min-analyzed': 'retention-min-analyzed',
  remoteUrl: 'remote-url',
  'remote-url': 'remote-url',
  remoteApiKey: 'remote-api-key',
  'remote-api-key': 'remote-api-key',
};

const CANONICAL_TO_PROP: Record<string, keyof ReturnType<typeof loadConfig>> = {
  'gemini-api-key': 'geminiApiKey',
  'db-path': 'dbPath',
  'analyze-provider': 'analyzeProvider',
  'ollama-url': 'ollamaUrl',
  'ollama-model': 'ollamaModel',
  'openrouter-model': 'openrouterModel',
  'openrouter-url': 'openrouterUrl',
  'openrouter-api-key': 'openrouterApiKey',
  'mlx-serve-model': 'mlxServeModel',
  'mlx-serve-url': 'mlxServeUrl',
  'mlx-serve-api-key': 'mlxServeApiKey',
  'ollama-embed-model': 'ollamaEmbedModel',
  'filter-min-length': 'filterMinLength',
  'filter-min-relevance': 'filterMinRelevance',
  'background-analysis': 'backgroundAnalysis',
  'retention-days': 'retentionDays',
  'retention-min-relevance': 'retentionMinRelevance',
  'retention-min-starred': 'retentionMinStarred',
  'retention-min-analyzed': 'retentionMinAnalyzed',
  'remote-url': 'remoteUrl',
  'remote-api-key': 'remoteApiKey',
};

function parseBooleanConfig(key: string, val: string): boolean {
  if (val === 'true' || val === '1') return true;
  if (val === 'false' || val === '0') return false;
  throw new Error(`${key} must be true or false`);
}

export async function cmdConfig(args: string[]): Promise<void> {
  if (args[0] === 'show') {
    const cfg = loadConfig();
    console.log('Analysis providers (* = active; credentials are never shown):');
    for (const provider of getProviderSummaries(cfg)) console.log(formatProviderSummary(provider));
    console.log('Configure with: ph config set analyze-provider <ollama|gemini|openrouter|mlx-serve>');
    return;
  }

  if (args[0] === 'get' && args.length >= 2) {
    const rawKey = args[1];
    const key = KEY_ALIASES[rawKey];
    if (!key) throw new Error(`unknown config key "${rawKey}"`);
    const cfg = loadConfig();
    const prop = CANONICAL_TO_PROP[key];
    const value = cfg[prop];
    if (SECRET_KEYS.has(key)) {
      console.log(value ? '[redacted]' : '(not set)');
      return;
    }
    console.log(value !== undefined ? String(value) : '(not set)');
    return;
  }

  if (args[0] !== 'set' || args.length < 2) {
    console.log('Usage: ph config show | ph config get <key> | ph config set <key> [value]');
    console.log('Keys: gemini-api-key, db-path, analyze-provider, ollama-url, ollama-model,');
    console.log('      openrouter-model, openrouter-url, openrouter-api-key,');
    console.log('      mlx-serve-model, mlx-serve-url, mlx-serve-api-key,');
    console.log('      ollama-embed-model, filter-min-length, filter-min-relevance, background-analysis,');
    console.log('      retention-days, retention-min-relevance, retention-min-starred, retention-min-analyzed,');
    console.log('      remote-url, remote-api-key');
    return;
  }

  const cfg = loadConfig();
  const rawKey = args[1];
  const key = KEY_ALIASES[rawKey];
  if (!key) throw new Error(`unknown config key "${rawKey}"`);

  let val = args.slice(2).join(' ');
  if (!val && SECRET_KEYS.has(key)) val = await readSecret(`${key}: `);
  if (!val) throw new Error(`A value is required for ${rawKey}.`);

  switch (key) {
    case 'gemini-api-key': cfg.geminiApiKey = val; break;
    case 'db-path': cfg.dbPath = val; break;
    case 'analyze-provider':
      if (!['ollama', 'gemini', 'openrouter', 'mlx-serve'].includes(val)) throw new Error('analyze-provider must be ollama, gemini, openrouter, or mlx-serve');
      cfg.analyzeProvider = val as NonNullable<typeof cfg.analyzeProvider>;
      break;
    case 'ollama-url': cfg.ollamaUrl = val; break;
    case 'ollama-model': cfg.ollamaModel = val; break;
    case 'openrouter-model': cfg.openrouterModel = val; break;
    case 'openrouter-url': cfg.openrouterUrl = val; break;
    case 'openrouter-api-key': cfg.openrouterApiKey = val; break;
    case 'mlx-serve-model': cfg.mlxServeModel = val; break;
    case 'mlx-serve-url': cfg.mlxServeUrl = val; break;
    case 'mlx-serve-api-key': cfg.mlxServeApiKey = val; break;
    case 'ollama-embed-model': cfg.ollamaEmbedModel = val; break;
    case 'filter-min-length': {
      const n = Number(val);
      if (!Number.isInteger(n) || n < 0) throw new Error('filter-min-length must be a non-negative integer');
      cfg.filterMinLength = n;
      break;
    }
    case 'filter-min-relevance': {
      const n = Number(val);
      if (!Number.isInteger(n) || n < 0 || n > 10) throw new Error('filter-min-relevance must be 0-10');
      cfg.filterMinRelevance = n;
      break;
    }
    case 'background-analysis': cfg.backgroundAnalysis = parseBooleanConfig(rawKey, val); break;
    case 'retention-days': {
      const n = Number(val);
      if (!Number.isInteger(n) || n < 1) throw new Error('retention-days must be a positive integer');
      cfg.retentionDays = n;
      break;
    }
    case 'retention-min-relevance': {
      const n = Number(val);
      if (!Number.isInteger(n) || n < 0 || n > 10) throw new Error('retention-min-relevance must be 0-10');
      cfg.retentionMinRelevance = n;
      break;
    }
    case 'retention-min-starred': cfg.retentionMinStarred = parseBooleanConfig(rawKey, val); break;
    case 'retention-min-analyzed': cfg.retentionMinAnalyzed = parseBooleanConfig(rawKey, val); break;
    case 'remote-url': parseRemoteUrl(val); cfg.remoteUrl = val; break;
    case 'remote-api-key': cfg.remoteApiKey = val; break;
    default: throw new Error(`unknown config key "${rawKey}"`);
  }

  saveConfig(cfg);
  console.log(SECRET_KEYS.has(key) ? `Config "${key}" updated (value hidden).` : `Config "${key}" updated successfully.`);
}

function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error(`No value supplied for ${prompt.trim()}; use an environment variable in non-interactive shells.`);
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const previousRawMode = input.isRaw ?? false;
    let value = '';
    process.stderr.write(prompt);
    input.setRawMode(true);
    input.resume();
    const cleanup = () => {
      input.removeListener('data', onData);
      input.setRawMode(previousRawMode);
      process.stderr.write('\n');
    };
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) { cleanup(); reject(new Error('Input cancelled.')); return; }
        if (byte === 13 || byte === 10) { cleanup(); resolve(value); return; }
        if (byte === 127 || byte === 8) value = value.slice(0, -1);
        else if (byte >= 32) value += String.fromCharCode(byte);
      }
    };
    input.on('data', onData);
  });
}
