import type { PhConfig } from './index.js';

export interface ProviderSummary {
  id: NonNullable<PhConfig['analyzeProvider']>;
  label: string;
  model: string;
  url: string;
  credential: 'configured' | 'not set' | 'not required';
  active: boolean;
  ready: boolean;
}

export function getProviderSummaries(cfg: PhConfig): ProviderSummary[] {
  const active = cfg.analyzeProvider ?? 'ollama';
  return [
    {
      id: 'ollama', label: 'Ollama',
      model: cfg.ollamaModel ?? 'llama3.1:latest',
      url: cfg.ollamaUrl ?? 'http://localhost:11434',
      credential: 'not required', active: active === 'ollama', ready: true,
    },
    {
      id: 'gemini', label: 'Gemini',
      model: 'gemini-2.5-flash', url: '(default)',
      credential: process.env.GEMINI_API_KEY || cfg.geminiApiKey ? 'configured' : 'not set',
      active: active === 'gemini', ready: Boolean(process.env.GEMINI_API_KEY || cfg.geminiApiKey),
    },
    {
      id: 'openrouter', label: 'OpenRouter',
      model: process.env.OPENROUTER_MODEL ?? cfg.openrouterModel ?? '(not set)',
      url: process.env.OPENROUTER_BASE_URL ?? cfg.openrouterUrl ?? 'https://openrouter.ai/api/v1',
      credential: process.env.OPENROUTER_API_KEY || cfg.openrouterApiKey ? 'configured' : 'not set',
      active: active === 'openrouter', ready: Boolean((process.env.OPENROUTER_API_KEY || cfg.openrouterApiKey) && (process.env.OPENROUTER_MODEL || cfg.openrouterModel)),
    },
    {
      id: 'mlx-serve', label: 'MLX-Serve',
      model: process.env.MLX_SERVE_MODEL ?? cfg.mlxServeModel ?? '(not set)',
      url: process.env.MLX_SERVE_BASE_URL ?? cfg.mlxServeUrl ?? 'http://127.0.0.1:11234/v1',
      credential: process.env.MLX_SERVE_API_KEY || process.env.GLB_OMLX_API_KEY || cfg.mlxServeApiKey ? 'configured' : 'not required',
      active: active === 'mlx-serve', ready: Boolean(process.env.MLX_SERVE_MODEL || cfg.mlxServeModel),
    },
  ];
}

export function formatProviderSummary(provider: ProviderSummary): string {
  return `${provider.active ? '*' : ' '} ${provider.label}: model=${provider.model}, url=${provider.url}, key=${provider.credential}, setup=${provider.ready ? 'ready' : 'incomplete'}`;
}
