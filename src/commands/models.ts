import type { PhConfig } from '../config/index.js';
import { discoverModels, MLX_SERVE_DEFAULT_URL, OPENROUTER_DEFAULT_URL } from '../ai/wise.js';

export async function cmdModels(cfg: PhConfig, args: string[]): Promise<void> {
  const provider = args[0] ?? cfg.analyzeProvider;
  if (provider !== 'openrouter' && provider !== 'mlx-serve') {
    throw new Error('Choose a provider: `ph models openrouter` or `ph models mlx-serve`.');
  }

  const cfgKey = provider === 'openrouter' ? cfg.openrouterApiKey : cfg.mlxServeApiKey;
  if (provider === 'openrouter' && !(process.env.OPENROUTER_API_KEY || cfgKey)) {
    throw new Error('Configure a key with `ph config set openrouter-api-key` or set OPENROUTER_API_KEY.');
  }

  const apiKey = provider === 'openrouter'
    ? process.env.OPENROUTER_API_KEY ?? cfg.openrouterApiKey!
    : process.env.MLX_SERVE_API_KEY ?? process.env.GLB_OMLX_API_KEY ?? cfg.mlxServeApiKey ?? 'local';
  const baseUrl = provider === 'openrouter'
    ? process.env.OPENROUTER_BASE_URL ?? cfg.openrouterUrl ?? OPENROUTER_DEFAULT_URL
    : process.env.MLX_SERVE_BASE_URL ?? cfg.mlxServeUrl ?? MLX_SERVE_DEFAULT_URL;

  let models;
  try {
    models = await discoverModels(provider, apiKey, baseUrl);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const tunnel = provider === 'mlx-serve' && /127\.0\.0\.1|localhost/.test(baseUrl)
      ? '\nParmenide: apri in un altro terminale `ssh -N -L 11234:127.0.0.1:11234 parmenide`, poi riprova. Puoi impostare un URL raggiungibile con `ph config set mlx-serve-url <url>`.'
      : '';
    throw new Error(`Cannot query ${provider} at ${baseUrl}: ${detail}${tunnel}`);
  }
  if (models.length === 0) {
    const tunnel = provider === 'mlx-serve'
      ? '\nSe il CLI gira sul Mac e il server su Parmenide, apri: ssh -N -L 11234:127.0.0.1:11234 parmenide'
      : '';
    throw new Error(`No models returned by ${provider} at ${baseUrl}. Check connectivity and credentials.${tunnel}`);
  }

  console.log(`Models listed by ${provider} at ${baseUrl}:`);
  for (const model of models) {
    const status = model.loaded === undefined ? '' : model.loaded ? ' [loaded]' : ` [${model.state ?? 'unloaded'}]`;
    console.log(`  ${model.id}${model.name !== model.id ? `  — ${model.name}` : ''}${status}`);
  }
  if (provider === 'mlx-serve') {
    console.log('\nph can list installed models even when they are unloaded. Select a model marked [loaded] to run it immediately.');
  }
}
