import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider, discoverModels } from '../openai-compatible.js';
import { GeminiProvider } from '../gemini.js';
import { getProvider } from '../provider.js';
import { analyzePromptDetailed } from '../../analyzer/index.js';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
  DEFAULT_OMLX_URL,
  DEFAULT_OPENROUTER_URL,
  normalizeOmlxBaseUrl,
  resolveOmlxApiKey,
  resolveOmlxUrl,
} from '../../config/defaults.js';
import { getProviderSummaries } from '../../config/provider-summary.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('OpenAICompatibleProvider', () => {
  it('posts chat completions with bearer auth, JSON format, and extraBody', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"ok"}' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleProvider('oMLX', 'test-model', {
      apiKey: 'secret-token',
      baseUrl: 'http://127.0.0.1:8000/v1/',
      extraBody: { reasoning_budget_tokens: 0 },
    });

    const out = await provider.generate('Analyze this', { maxOutputTokens: 800, think: false, format: 'json' });
    expect(out).toBe('{"summary":"ok"}');
    expect(provider.name).toBe('oMLX (test-model)');

    const [url, init] = fetchMock.mock.calls[0] as [string, { method?: string; headers?: Record<string, string>; body?: string }];
    expect(url).toBe('http://127.0.0.1:8000/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer secret-token',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Analyze this' }],
      max_tokens: 800,
      response_format: { type: 'json_object' },
      reasoning_budget_tokens: 0,
    });
  });

  it('joins array content parts when returned by OpenAI-compatible responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: [{ type: 'text', text: '{"role":' }, { type: 'text', text: '"debug"}' }] } }],
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleProvider('OpenRouter', 'test-model', {
      apiKey: 'secret',
      baseUrl: DEFAULT_OPENROUTER_URL,
    });

    await expect(provider.generate('Analyze')).resolves.toBe('{"role":"debug"}');
  });

  it('preserves HTTP 507 statusCode so analyzer classifies OOM', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Insufficient memory ceiling exceeded', { status: 507 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleProvider('oMLX', 'big-model', {
      apiKey: 'local',
      baseUrl: DEFAULT_OMLX_URL,
    });

    await expect(provider.generate('prompt')).rejects.toMatchObject({
      statusCode: 507,
    });

    const detailed = await analyzePromptDetailed('prompt', provider);
    expect(detailed).toEqual({ result: {}, error: 'provider_out_of_memory' });
  });

  it('discovers models via native fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'model-a', loaded: true }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await discoverModels('omlx', 'local');
    expect(models).toEqual([{ id: 'model-a', name: 'model-a', loaded: true, state: undefined }]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_OMLX_URL}/models`);
  });
});

describe('GeminiProvider', () => {
  it('sends API key via x-goog-api-key header instead of URL query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"role":"debug"}' }] } }],
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GeminiProvider(DEFAULT_GEMINI_MODEL, 'gemini-secret');
    const result = await provider.generate('Inspect this', { maxOutputTokens: 400, format: 'json' });
    expect(result).toBe('{"role":"debug"}');

    const [url, init] = fetchMock.mock.calls[0] as [string, { headers?: Record<string, string>; body?: string }];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
    expect(url).not.toContain('key=');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-goog-api-key': 'gemini-secret',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      contents: [{ parts: [{ text: 'Inspect this' }] }],
      generationConfig: {
        maxOutputTokens: 400,
        responseMimeType: 'application/json',
      },
    });
  });
});

describe('clean OSS provider defaults', () => {
  it('does not contain parmenide or GLB_ defaults', () => {
    vi.stubEnv('GLB_OMLX_API_KEY', 'should-be-ignored');
    vi.stubEnv('OMLX_API_KEY', undefined);
    vi.stubEnv('MLX_SERVE_API_KEY', undefined);
    vi.stubEnv('OMLX_BASE_URL', undefined);
    vi.stubEnv('MLX_SERVE_BASE_URL', undefined);

    expect(DEFAULT_OLLAMA_URL).toBe('http://localhost:11434');
    expect(DEFAULT_OLLAMA_MODEL).toBe('llama3.1:latest');
    expect(DEFAULT_OPENROUTER_URL).toBe('https://openrouter.ai/api/v1');
    expect(DEFAULT_OMLX_URL).toBe('http://127.0.0.1:8000/v1');
    expect(resolveOmlxUrl({})).toBe('http://127.0.0.1:8000/v1');
    expect(normalizeOmlxBaseUrl('http://127.0.0.1:8000/v1/')).toBe('http://127.0.0.1:8000/v1');
    expect(resolveOmlxApiKey({})).toBeUndefined();

    const summaries = getProviderSummaries({});
    for (const summary of summaries) {
      expect(summary.url).not.toContain('parmenide');
      expect(summary.model).not.toContain('qwen3.5:9b-mlx');
    }
    expect(getProvider({})?.name).toBe('ollama');
  });
});
