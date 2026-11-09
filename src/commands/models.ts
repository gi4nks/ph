import type { PhConfig } from '../config/index.js';
import { discoverModels, OMLX_DEFAULT_URL, normalizeOmlxBaseUrl, OPENROUTER_DEFAULT_URL } from '../ai/wise.js';

export async function cmdModels(cfg: PhConfig, args: string[]): Promise<void> {
  const selectedProvider = args[0] ?? cfg.analyzeProvider;
  const provider = selectedProvider === 'mlx-serve' ? 'omlx' : selectedProvider;

  if (provider === 'ollama') {
    const ollamaUrl = cfg.ollamaUrl ?? 'http://127.0.0.1:8000';
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { models?: Array<{ name: string }> };
      const models = (data.models ?? []).map(m => m.name).filter(Boolean);
      if (models.length === 0) {
        console.log('No models found on Ollama.');
      } else {
        console.log(`Available Ollama models at ${ollamaUrl}:`);
        for (const m of models) console.log(`  ${m}`);
      }
    } catch (err: unknown) {
      process.stderr.write(`ph: cannot reach Ollama at ${ollamaUrl}: ${(err as Error).message}\n`);
      process.exit(1);
    }
    return;
  }

  if (provider !== 'openrouter' && provider !== 'omlx') {
    throw new Error('Choose a provider: `ph models ollama`, `ph models openrouter`, or `ph models omlx`.');
  }

  const cfgKey = provider === 'openrouter' ? cfg.openrouterApiKey : cfg.omlxApiKey ?? cfg.mlxServeApiKey;
  if (provider === 'openrouter' && !(process.env.OPENROUTER_API_KEY || cfgKey)) {
    throw new Error('Configure a key with `ph config set openrouter-api-key` or set OPENROUTER_API_KEY.');
  }

  const apiKey = provider === 'openrouter'
    ? process.env.OPENROUTER_API_KEY ?? cfg.openrouterApiKey!
    : process.env.OMLX_API_KEY ?? process.env.MLX_SERVE_API_KEY ?? process.env.GLB_OMLX_API_KEY ?? cfg.omlxApiKey ?? cfg.mlxServeApiKey ?? 'local';
  const baseUrl = provider === 'openrouter'
    ? process.env.OPENROUTER_BASE_URL ?? cfg.openrouterUrl ?? OPENROUTER_DEFAULT_URL
    : normalizeOmlxBaseUrl(process.env.OMLX_BASE_URL ?? process.env.MLX_SERVE_BASE_URL ?? cfg.omlxUrl ?? cfg.mlxServeUrl ?? OMLX_DEFAULT_URL);

  let models;
  try {
    models = await discoverModels(provider, apiKey, baseUrl);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const tunnel = provider === 'omlx' && /127\.0\.0\.1|localhost/.test(baseUrl)
      ? '\nCheck that the inference service is running and that any required SSH tunnel is open. You can set a reachable endpoint with `ph config set omlx-url <url>`.'
      : '';
    throw new Error(`Cannot query ${provider} at ${baseUrl}: ${detail}${tunnel}`);
  }
  if (models.length === 0) {
    const tunnel = provider === 'omlx'
      ? '\nCheck that the configured inference service is reachable and returning models.'
      : '';
    throw new Error(`No models returned by ${provider} at ${baseUrl}. Check connectivity and credentials.${tunnel}`);
  }

  console.log(`Models listed by ${provider} at ${baseUrl}:`);
  for (const model of models) {
    const status = model.loaded === undefined ? '' : model.loaded ? ' [loaded]' : ` [${model.state ?? 'unloaded'}]`;
    console.log(`  ${model.id}${model.name !== model.id ? `  — ${model.name}` : ''}${status}`);
  }
  if (provider === 'omlx') {
    console.log('\noMLX can load installed models on the first inference request. Cold loading needs enough free memory on the server; a smaller model may be required.');
  }
}
