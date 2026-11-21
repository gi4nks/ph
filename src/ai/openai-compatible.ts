import {
  DEFAULT_OMLX_URL,
  DEFAULT_OPENROUTER_URL,
  normalizeOmlxBaseUrl,
} from '../config/defaults.js';
import type { LLMProvider } from './provider.js';

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl: string;
  extraBody?: Record<string, unknown>;
}

interface ChatCompletionContentPart {
  type?: string;
  text?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | ChatCompletionContentPart[] | null;
    };
  }>;
}

interface OpenAIModelItem {
  id?: string;
  name?: string;
  loaded?: boolean;
  state?: string;
}

/** OpenAI-compatible chat completions provider backed by native fetch. */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;

  constructor(
    private readonly displayName: string,
    private readonly modelId: string,
    private readonly config: OpenAICompatibleConfig,
  ) {
    this.name = `${displayName} (${modelId})`;
  }

  async generate(
    prompt: string,
    options?: { maxOutputTokens?: number; think?: boolean; format?: 'json' },
  ): Promise<string> {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    const body: Record<string, unknown> = {
      model: this.modelId,
      messages: [{ role: 'user', content: prompt }],
      ...(options?.maxOutputTokens ? { max_tokens: options.maxOutputTokens } : {}),
      ...(options?.format === 'json' ? { response_format: { type: 'json_object' } } : {}),
      ...(this.config.extraBody ?? {}),
    };

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const err = new Error(`${this.displayName} API error ${res.status}: ${errBody}`);
      (err as { statusCode?: number }).statusCode = res.status;
      throw err;
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(part => (typeof part?.text === 'string' ? part.text : '')).join('');
    }
    return '';
  }
}

export interface DiscoveredModel {
  id: string;
  name: string;
  loaded?: boolean;
  state?: string;
}

export async function discoverModels(
  provider: 'openrouter' | 'omlx' | 'mlx-serve',
  apiKey: string,
  baseUrl?: string,
): Promise<DiscoveredModel[]> {
  const isOmlx = provider === 'omlx' || provider === 'mlx-serve';
  const url = isOmlx
    ? normalizeOmlxBaseUrl(baseUrl || DEFAULT_OMLX_URL)
    : (baseUrl || DEFAULT_OPENROUTER_URL).replace(/\/+$/, '');

  const response = await fetch(`${url}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = (await response.json()) as { data?: OpenAIModelItem[] };
  return (data.data ?? [])
    .filter((model): model is OpenAIModelItem & { id: string } => typeof model.id === 'string' && model.id.length > 0)
    .map(model => (
      isOmlx
        ? { id: model.id, name: model.name || model.id, loaded: model.loaded, state: model.state }
        : { id: model.id, name: model.name || model.id }
    ));
}
