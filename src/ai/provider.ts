import type { PhConfig } from '../config/index.js';
import { OllamaProvider } from './ollama.js';
import { GeminiProvider } from './gemini.js';

export interface LLMProvider {
  readonly name: string;
  generate(prompt: string): Promise<string>;
}

/**
 * Returns the configured LLM provider, or null if none can be constructed.
 * Priority: explicit config → 'ollama' as default.
 */
export function getProvider(cfg: PhConfig): LLMProvider | null {
  const provider = cfg.analyzeProvider ?? 'ollama';

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY ?? cfg.geminiApiKey;
    if (!apiKey) return null;
    return new GeminiProvider('gemini-2.5-flash', apiKey);
  }

  // ollama (default)
  return new OllamaProvider(
    cfg.ollamaUrl ?? 'http://localhost:11434',
    cfg.ollamaModel ?? 'llama3.1:latest'
  );
}
