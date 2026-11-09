import { generateText, type LanguageModel } from 'ai';
import { createAIModel, type ProviderConfig } from '@gi4nks/wise';
import type { LLMProvider } from './provider.js';

export const OPENROUTER_DEFAULT_URL = 'https://openrouter.ai/api/v1';
export const OMLX_DEFAULT_URL = 'http://parmenide:8000/v1';
/** @deprecated Use OMLX_DEFAULT_URL. */
export const MLX_SERVE_DEFAULT_URL = OMLX_DEFAULT_URL;

export function normalizeOmlxBaseUrl(value: string): string {
  return value.replace(/^http:\/\/parmenide:(?:8010|11234|11434)(?=\/|$)/i, 'http://parmenide:8000');
}
/** @deprecated Use normalizeOmlxBaseUrl. */
export const normalizeMlxServeBaseUrl = normalizeOmlxBaseUrl;

type WiseProviderName = 'openai' | 'omlx';

export class WiseLLMProvider implements LLMProvider {
  readonly name: string;
  private readonly model: LanguageModel;

  constructor(
    wiseProvider: WiseProviderName,
    displayName: string,
    modelId: string,
    config: ProviderConfig,
  ) {
    this.name = `${displayName} (${modelId})`;
    // OpenRouter and oMLX both speak the OpenAI-compatible API used by Wise.
    this.model = createAIModel(wiseProvider, modelId, config);
  }

  async generate(prompt: string, options?: { maxOutputTokens?: number }): Promise<string> {
    const result = await generateText({
      model: this.model,
      prompt,
      ...(options?.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
      // OpenRouter requests can incur cost. Avoid hidden automatic replays.
      maxRetries: 0,
    });
    return result.text;
  }
}

export async function discoverModels(
  provider: 'openrouter' | 'omlx' | 'mlx-serve',
  apiKey: string,
  baseUrl?: string,
): Promise<Array<{ id: string; name: string; loaded?: boolean; state?: string }>> {
  if (provider === 'omlx' || provider === 'mlx-serve') {
    const url = normalizeOmlxBaseUrl(baseUrl || OMLX_DEFAULT_URL).replace(/\/+$/, '');
    const response = await fetch(`${url}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { data?: Array<{ id?: string; name?: string; loaded?: boolean; state?: string }> };
    return (data.data ?? [])
      .filter((model): model is { id: string; name?: string; loaded?: boolean; state?: string } => typeof model.id === 'string' && model.id.length > 0)
      .map(model => ({ id: model.id, name: model.name || model.id, loaded: model.loaded, state: model.state }));
  }

  // Wise 2.1's generic OpenAI discovery falls back to a static catalog on errors.
  // Query OpenRouter's compatible catalog directly so a network failure cannot
  // present fake models as available. Generation still goes through Wise.
  const url = (baseUrl || OPENROUTER_DEFAULT_URL).replace(/\/+$/, '');
  const response = await fetch(`${url}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json() as { data?: Array<{ id?: string; name?: string }> };
  return (data.data ?? [])
    .filter((model): model is { id: string; name?: string } => typeof model.id === 'string' && model.id.length > 0)
    .map(model => ({ id: model.id, name: model.name || model.id }));
}
