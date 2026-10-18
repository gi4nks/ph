import { load as loadConfig, save as saveConfig } from '../config/index.js';
import { formatProviderSummary, getProviderSummaries } from '../config/provider-summary.js';

const SECRET_KEYS = ['gemini-api-key', 'openrouter-api-key', 'mlx-serve-api-key', 'remote-api-key'];

export async function cmdConfig(args: string[]): Promise<void> {
  if (args[0] === 'show') {
    const cfg = loadConfig();
    console.log('Analysis providers (* = active; credentials are never shown):');
    for (const provider of getProviderSummaries(cfg)) console.log(formatProviderSummary(provider));
    console.log('Configure with: ph config set analyze-provider <ollama|gemini|openrouter|mlx-serve>');
    return;
  }

  if (args[0] !== 'set' || args.length < 2) {
    console.log('Usage: ph config show | ph config set <key> [value]');
    console.log('Keys: gemini-api-key, db-path, analyze-provider, ollama-url, ollama-model,');
    console.log('      openrouter-model, openrouter-url, openrouter-api-key,');
    console.log('      mlx-serve-model, mlx-serve-url, mlx-serve-api-key,');
    console.log('      ollama-embed-model, filter-min-length, filter-min-relevance, background-analysis,');
    console.log('      remote-url, remote-api-key');
    return;
  }

  const cfg = loadConfig();
  const key = args[1];
  let val = args.slice(2).join(' ');
  if (!val && SECRET_KEYS.includes(key)) val = await readSecret(`${key}: `);
  if (!val) throw new Error(`A value is required for ${key}.`);

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
    case 'background-analysis': cfg.backgroundAnalysis = val === 'true' || val === '1'; break;
    case 'remote-url': cfg.remoteUrl = val; break;
    case 'remote-api-key': cfg.remoteApiKey = val; break;
    default: throw new Error(`unknown config key "${key}"`);
  }

  saveConfig(cfg);
  console.log(SECRET_KEYS.includes(key) ? `Config "${key}" updated (value hidden).` : `Config "${key}" updated successfully.`);
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
