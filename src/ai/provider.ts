import type { PhConfig } from '../config/index.js';
import { OllamaProvider } from './ollama.js';
import { GeminiProvider } from './gemini.js';
import { OMLX_DEFAULT_URL, normalizeOmlxBaseUrl, OPENROUTER_DEFAULT_URL, WiseLLMProvider } from './wise.js';

export interface LLMProvider {
  readonly name: string;
  generate(prompt: string, options?: { maxOutputTokens?: number; think?: boolean; format?: 'json' }): Promise<string>;
}

export function getProviderSetupError(cfg: PhConfig, selectedProvider?: PhConfig['analyzeProvider']): string | null {
  const provider = selectedProvider ?? cfg.analyzeProvider ?? 'ollama';
  if (provider === 'openrouter') {
    if (!(process.env.OPENROUTER_API_KEY || cfg.openrouterApiKey)) return 'Set a key with `ph config set openrouter-api-key` or OPENROUTER_API_KEY.';
    if (!(process.env.OPENROUTER_MODEL || cfg.openrouterModel)) return 'Choose a model with `ph config set openrouter-model <provider/model>`.';
  }
  if ((provider === 'omlx' || provider === 'mlx-serve') && !(process.env.OMLX_MODEL || process.env.MLX_SERVE_MODEL || cfg.omlxModel || cfg.mlxServeModel)) {
    return 'Choose an oMLX model with `ph config set omlx-model <model-id>`.';
  }
  return null;
}

/**
 * Returns the configured LLM provider, or null if none can be constructed.
 * Priority: explicit config → 'ollama' as default.
 */
export function getProvider(cfg: PhConfig, selectedProvider?: PhConfig['analyzeProvider']): LLMProvider | null {
  const provider = selectedProvider ?? cfg.analyzeProvider ?? 'ollama';

  if (provider === 'openrouter') {
    const apiKey = process.env.OPENROUTER_API_KEY ?? cfg.openrouterApiKey;
    const model = process.env.OPENROUTER_MODEL ?? cfg.openrouterModel;
    if (!apiKey || !model) return null;
    return new WiseLLMProvider('openai', 'OpenRouter', model, {
      openai: {
        apiKey,
        baseUrl: process.env.OPENROUTER_BASE_URL ?? cfg.openrouterUrl ?? OPENROUTER_DEFAULT_URL,
      },
    });
  }

  if (provider === 'omlx' || provider === 'mlx-serve') {
    const model = process.env.OMLX_MODEL ?? process.env.MLX_SERVE_MODEL ?? cfg.omlxModel ?? cfg.mlxServeModel;
    if (!model) return null;
    const apiKey = process.env.OMLX_API_KEY ?? process.env.MLX_SERVE_API_KEY ?? process.env.GLB_OMLX_API_KEY ?? cfg.omlxApiKey ?? cfg.mlxServeApiKey ?? 'local';
    return new WiseLLMProvider('omlx', 'oMLX', model, {
      omlx: {
        apiKey,
        baseUrl: normalizeOmlxBaseUrl(process.env.OMLX_BASE_URL ?? process.env.MLX_SERVE_BASE_URL ?? cfg.omlxUrl ?? cfg.mlxServeUrl ?? OMLX_DEFAULT_URL),
        // PH analysis produces structured metadata, not chain-of-thought.
        extraBody: {
          reasoning_budget_tokens: 0,
          response_format: { type: 'json_object' },
        },
      },
    });
  }

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY ?? cfg.geminiApiKey;
    if (!apiKey) return null;
    return new GeminiProvider('gemini-2.5-flash', apiKey);
  }

  // ollama (default)
  return new OllamaProvider(
    cfg.ollamaUrl ?? 'http://127.0.0.1:8000',
    cfg.ollamaModel ?? 'qwen3.5:9b-mlx'
  );
}
