import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { getEmbeddings } from '../embedding/index.js';
import { DEFAULT_EMBED_MODEL } from '../context/index.js';

export async function cmdEmbedAll(db: PhDB, cfg: PhConfig, args: string[] = []): Promise<void> {
  const ollamaUrl = cfg.ollamaUrl ?? 'http://localhost:11434';
  const model = cfg.ollamaEmbedModel ?? DEFAULT_EMBED_MODEL;
  const force = args.includes('--force');
  const storedModel = db.getEmbeddingModel();

  if (storedModel && storedModel !== model && db.getEmbeddingCount() > 0 && !force) {
    throw new Error(
      `Existing vectors were built with "${storedModel}" but "${model}" is configured. ` +
      'Run `ph embed-all --force` to rebuild the semantic index with the configured model.',
    );
  }
  if (force && db.getEmbeddingCount() > 0) {
    console.log(`Clearing ${db.getEmbeddingCount()} existing vectors${storedModel ? ` (${storedModel})` : ''}...`);
    db.clearEmbeddings();
  }

  const toEmbed = db.getPromptsWithoutEmbeddings();
  if (toEmbed.length === 0) {
    console.log('No new prompts to embed.');
    return;
  }

  const batchSize = 20;
  console.log(`Generating embeddings for ${toEmbed.length} prompts via Ollama (${model}), batches of ${batchSize}...`);

  let saved = 0;
  let failed = 0;
  for (let i = 0; i < toEmbed.length; i += batchSize) {
    const batch = toEmbed.slice(i, i + batchSize);
    const texts = batch.map(e => e.response ? `${e.prompt}\n\n${e.response}` : e.prompt);
    process.stdout.write(`\r→ ${i + batch.length}/${toEmbed.length}...`);

    try {
      const vecs = await getEmbeddings(texts, ollamaUrl, model, batchSize);
      for (let j = 0; j < vecs.length; j++) {
        try {
          db.saveEmbedding(batch[j].id, vecs[j], model);
          saved++;
        } catch (e: unknown) {
          failed++;
          console.log(`\n  ! DB error for #${batch[j].id}: ${(e as Error).message}`);
        }
      }
    } catch (e: unknown) {
      failed += batch.length;
      console.log(`\n  ! Batch error: ${(e as Error).message}`);
      if (saved === 0 && i === 0) throw new Error(`Cannot reach the embedding model at ${ollamaUrl}: ${(e as Error).message}`);
    }
  }

  console.log(`\nDone: ${saved} embedded${failed ? `, ${failed} failed` : ''} (model: ${model}).`);
}
