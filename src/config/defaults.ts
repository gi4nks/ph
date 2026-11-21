import type { PhConfig } from './index.js';

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
export const DEFAULT_OLLAMA_MODEL = 'llama3.1:latest';
export const DEFAULT_EMBED_MODEL = 'nomic-embed-text-v2-moe';
export const DEFAULT_OPENROUTER_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_OMLX_URL = 'http://127.0.0.1:8000/v1';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

type RuntimeEnv = Record<string, string | undefined>;

export function normalizeOmlxBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveOllamaUrl(
  cfg: Pick<PhConfig, 'ollamaUrl'>,
  _env: RuntimeEnv = process.env,
): string {
  return cfg.ollamaUrl ?? DEFAULT_OLLAMA_URL;
}

export function resolveOllamaModel(cfg: Pick<PhConfig, 'ollamaModel'>): string {
  return cfg.ollamaModel ?? DEFAULT_OLLAMA_MODEL;
}

export function resolveOpenRouterUrl(
  cfg: Pick<PhConfig, 'openrouterUrl'>,
  env: RuntimeEnv = process.env,
): string {
  return env.OPENROUTER_BASE_URL ?? cfg.openrouterUrl ?? DEFAULT_OPENROUTER_URL;
}

export function resolveOmlxUrl(
  cfg: Pick<PhConfig, 'omlxUrl' | 'mlxServeUrl'>,
  env: RuntimeEnv = process.env,
): string {
  return normalizeOmlxBaseUrl(
    env.OMLX_BASE_URL ?? env.MLX_SERVE_BASE_URL ?? cfg.omlxUrl ?? cfg.mlxServeUrl ?? DEFAULT_OMLX_URL,
  );
}

export function resolveOmlxModel(
  cfg: Pick<PhConfig, 'omlxModel' | 'mlxServeModel'>,
  env: RuntimeEnv = process.env,
): string | undefined {
  return env.OMLX_MODEL ?? env.MLX_SERVE_MODEL ?? cfg.omlxModel ?? cfg.mlxServeModel;
}

export function resolveOmlxApiKey(
  cfg: Pick<PhConfig, 'omlxApiKey' | 'mlxServeApiKey'>,
  env: RuntimeEnv = process.env,
): string | undefined {
  return env.OMLX_API_KEY ?? env.MLX_SERVE_API_KEY ?? cfg.omlxApiKey ?? cfg.mlxServeApiKey;
}
