import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { getEmbeddings } from '../embedding/index.js';

export async function cmdEmbedAll(db: PhDB, cfg: PhConfig): Promise<void> {
  const ollamaUrl = cfg.ollamaUrl ?? 'http://localhost:11434';
  const model = cfg.ollamaEmbedModel ?? 'nomic-embed-text-v2-moe';

  const toEmbed = db.getPromptsWithoutEmbeddings();

  if (toEmbed.length === 0) {
    console.log('No new prompts to embed.');
    return;
  }

  const batchSize = 20;
  console.log(
    `Generating embeddings for ${toEmbed.length} prompts via Ollama (${model}), batches of ${batchSize}...`
  );

  for (let i = 0; i < toEmbed.length; i += batchSize) {
    const batch = toEmbed.slice(i, i + batchSize);
    const texts = batch.map((e) => e.response ? `${e.prompt}\n\n${e.response}` : e.prompt);
    process.stdout.write(`\r→ ${i + batch.length}/${toEmbed.length}...`);

    try {
      const vecs = await getEmbeddings(texts, ollamaUrl, model, batchSize);
      for (let j = 0; j < vecs.length; j++) {
        try {
          db.saveEmbedding(batch[j].id, vecs[j]);
        } catch (e: unknown) {
          console.log(`\n  ! DB error for #${batch[j].id}: ${(e as Error).message}`);
        }
      }
    } catch (e: unknown) {
      console.log(`\n  ! Batch error: ${(e as Error).message}`);
    }
  }

  console.log('\nDone!');
}
