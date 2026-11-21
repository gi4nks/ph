interface OllamaEmbedResponse {
  embeddings: number[][];
}

export async function getEmbeddings(
  texts: string[],
  ollamaUrl: string,
  model: string,
  batchSize = 20,
  timeoutMs = 30_000,
): Promise<Float32Array[]> {
  const baseUrl = ollamaUrl.replace(/\/+$/, '');
  const results: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    const res = await fetch(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: batch }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama embed error ${res.status}: ${err}`);
    }

    const data = (await res.json()) as OllamaEmbedResponse;
    for (const vec of data.embeddings) {
      results.push(new Float32Array(vec));
    }
  }

  return results;
}
