import { generateText, type LanguageModel } from 'ai';
import { createAIModel, type ProviderConfig } from '@gi4nks/wise';
import type { LLMProvider } from './provider.js';

export const OPENROUTER_DEFAULT_URL = 'https://openrouter.ai/api/v1';
export const MLX_SERVE_DEFAULT_URL = 'http://127.0.0.1:11234/v1';

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
    // OpenRouter speaks the OpenAI API; MLX-Serve speaks the same API used by Wise's oMLX adapter.
    this.model = createAIModel(wiseProvider, modelId, config);
  }

  async generate(prompt: string): Promise<string> {
    const result = await generateText({
      model: this.model,
      prompt,
      // OpenRouter requests can incur cost. Avoid hidden automatic replays.
      maxRetries: 0,
    });
    return result.text;
  }
}

export async function discoverModels(
  provider: 'openrouter' | 'mlx-serve',
  apiKey: string,
  baseUrl?: string,
): Promise<Array<{ id: string; name: string; loaded?: boolean; state?: string }>> {
  if (provider === 'mlx-serve') {
    const url = (baseUrl || MLX_SERVE_DEFAULT_URL).replace(/\/+$/, '');
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
