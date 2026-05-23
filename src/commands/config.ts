import { load as loadConfig, save as saveConfig } from '../config/index.js';

export function cmdConfig(args: string[]): void {
  if (args.length < 3 || args[0] !== 'set') {
    console.log('Usage: ph config set <key> <value>');
    console.log('Keys: gemini-api-key, db-path, analyze-provider, ollama-url, ollama-model,');
    console.log('      ollama-embed-model, filter-min-length, filter-min-relevance, background-analysis,');
    console.log('      remote-url, remote-api-key');
    process.exit(1);
  }

  const cfg = loadConfig();
  const key = args[1];
  const val = args[2];

  switch (key) {
    case 'gemini-api-key':
      cfg.geminiApiKey = val;
      break;
    case 'db-path':
      cfg.dbPath = val;
      break;
    case 'analyze-provider':
      if (val !== 'ollama' && val !== 'gemini') {
        process.stderr.write('ph: analyze-provider must be "ollama" or "gemini"\n');
        process.exit(1);
      }
      cfg.analyzeProvider = val as 'ollama' | 'gemini';
      break;
    case 'ollama-url':
      cfg.ollamaUrl = val;
      break;
    case 'ollama-model':
      cfg.ollamaModel = val;
      break;
    case 'ollama-embed-model':
      cfg.ollamaEmbedModel = val;
      break;
    case 'filter-min-length': {
      const n = Number(val);
      if (isNaN(n) || n < 0) { process.stderr.write('ph: filter-min-length must be a non-negative integer\n'); process.exit(1); }
      cfg.filterMinLength = n;
      break;
    }
    case 'filter-min-relevance': {
      const n = Number(val);
      if (isNaN(n) || n < 0 || n > 10) { process.stderr.write('ph: filter-min-relevance must be 0-10\n'); process.exit(1); }
      cfg.filterMinRelevance = n;
      break;
    }
    case 'background-analysis':
      cfg.backgroundAnalysis = val === 'true' || val === '1';
      break;
    case 'remote-url':
      cfg.remoteUrl = val;
      break;
    case 'remote-api-key':
      cfg.remoteApiKey = val;
      break;
    default:
      process.stderr.write(`ph: unknown config key "${key}"\n`);
      process.exit(1);
  }

  saveConfig(cfg);
  console.log(`Config "${key}" updated successfully.`);
}
