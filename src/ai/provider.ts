import type { PhConfig } from '../config/index.js';
import {
  DEFAULT_GEMINI_MODEL,
  resolveOllamaModel,
  resolveOllamaUrl,
  resolveOmlxApiKey,
  resolveOmlxModel,
  resolveOmlxUrl,
  resolveOpenRouterUrl,
} from '../config/defaults.js';
import { OllamaProvider } from './ollama.js';
import { GeminiProvider } from './gemini.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

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
  if ((provider === 'omlx' || provider === 'mlx-serve') && !resolveOmlxModel(cfg)) {
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
    return new OpenAICompatibleProvider('OpenRouter', model, {
      apiKey,
      baseUrl: resolveOpenRouterUrl(cfg),
    });
  }

  if (provider === 'omlx' || provider === 'mlx-serve') {
    const model = resolveOmlxModel(cfg);
    if (!model) return null;
    const apiKey = resolveOmlxApiKey(cfg) ?? 'local';
    return new OpenAICompatibleProvider('oMLX', model, {
      apiKey,
      baseUrl: resolveOmlxUrl(cfg),
      // PH analysis produces structured metadata, not chain-of-thought.
      extraBody: {
        reasoning_budget_tokens: 0,
        response_format: { type: 'json_object' },
      },
    });
  }

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY ?? cfg.geminiApiKey;
    if (!apiKey) return null;
    return new GeminiProvider(DEFAULT_GEMINI_MODEL, apiKey);
  }

  // ollama (default)
  return new OllamaProvider(
    resolveOllamaUrl(cfg),
    resolveOllamaModel(cfg),
  );
}
