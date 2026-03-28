import type { LLMProvider } from './provider.js';

interface OllamaResponse {
  response: string;
  done: boolean;
}

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';

  constructor(
    private readonly url: string,
    private readonly model: string
  ) {}

  async generate(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    let res: Response;
    try {
      res = await fetch(`${this.url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt, stream: false }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = (err as Error).message ?? String(err);
      if (msg.includes('abort') || msg.includes('timeout')) {
        throw new Error(`Ollama request timed out (60s). Is Ollama running at ${this.url}?`);
      }
      throw new Error(`Ollama unreachable at ${this.url}: ${msg}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as OllamaResponse;
    return data.response ?? '';
  }
}
