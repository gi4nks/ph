import type { LLMProvider } from './provider.js';

const GENERATE_API =
  'https://generativelanguage.googleapis.com/v1beta/models';

interface GenerateResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
}

export async function generateContent(
  prompt: string,
  model: string,
  apiKey: string,
  options?: { maxOutputTokens?: number; format?: 'json' },
): Promise<string> {
  const generationConfig: Record<string, unknown> = {
    ...(options?.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options?.format === 'json' ? { responseMimeType: 'application/json' } : {}),
  };

  const res = await fetch(`${GENERATE_API}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as GenerateResponse;
  return data.candidates[0]?.content?.parts[0]?.text ?? '';
}

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';

  constructor(
    private readonly model: string,
    private readonly apiKey: string
  ) {}

  generate(
    prompt: string,
    options?: { maxOutputTokens?: number; think?: boolean; format?: 'json' },
  ): Promise<string> {
    return generateContent(prompt, this.model, this.apiKey, options);
  }
}
