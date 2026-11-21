import type { PhConfig } from './index.js';
import {
  DEFAULT_GEMINI_MODEL,
  resolveOllamaModel,
  resolveOllamaUrl,
  resolveOmlxApiKey,
  resolveOmlxModel,
  resolveOmlxUrl,
  resolveOpenRouterUrl,
} from './defaults.js';

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
  const omlxModel = resolveOmlxModel(cfg);
  return [
    {
      id: 'ollama', label: 'Ollama',
      model: resolveOllamaModel(cfg),
      url: resolveOllamaUrl(cfg),
      credential: 'not required', active: active === 'ollama', ready: true,
    },
    {
      id: 'gemini', label: 'Gemini',
      model: DEFAULT_GEMINI_MODEL, url: '(default)',
      credential: process.env.GEMINI_API_KEY || cfg.geminiApiKey ? 'configured' : 'not set',
      active: active === 'gemini', ready: Boolean(process.env.GEMINI_API_KEY || cfg.geminiApiKey),
    },
    {
      id: 'openrouter', label: 'OpenRouter',
      model: process.env.OPENROUTER_MODEL ?? cfg.openrouterModel ?? '(not set)',
      url: resolveOpenRouterUrl(cfg),
      credential: process.env.OPENROUTER_API_KEY || cfg.openrouterApiKey ? 'configured' : 'not set',
      active: active === 'openrouter', ready: Boolean((process.env.OPENROUTER_API_KEY || cfg.openrouterApiKey) && (process.env.OPENROUTER_MODEL || cfg.openrouterModel)),
    },
    {
      id: 'omlx', label: 'oMLX',
      model: omlxModel ?? '(not set)',
      url: resolveOmlxUrl(cfg),
      credential: resolveOmlxApiKey(cfg) ? 'configured' : 'not required',
      active: active === 'omlx' || active === 'mlx-serve', ready: Boolean(omlxModel),
    },
  ];
}

export function formatProviderSummary(provider: ProviderSummary): string {
  return `${provider.active ? '*' : ' '} ${provider.label}: model=${provider.model}, url=${provider.url}, key=${provider.credential}, setup=${provider.ready ? 'ready' : 'incomplete'}`;
}
