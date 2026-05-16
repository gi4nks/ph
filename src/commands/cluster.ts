import { PhDB } from '../db/index.js';
import { kmeans } from '../cluster/index.js';
import { parseFlags } from './_utils.js';

export async function cmdCluster(db: PhDB, args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const k = Number(flags['k'] ?? 5);
  const limitPerCluster = Number(flags['limit'] ?? 3);

  const embeddings = db.getAllEmbeddings();
  if (embeddings.size === 0) {
    console.error('ph: no embeddings found. Run `ph embed-all` first.');
    return;
  }

  console.log(`Clustering ${embeddings.size} prompts into ${k} groups...`);
  const clusters = kmeans(embeddings, k);

  const C = {
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    gray: '\x1b[90m',
  };

  clusters.forEach((cluster, i) => {
    if (cluster.entryIds.length === 0) return;
    console.log(`\n${C.cyan}Cluster #${i + 1}${C.reset} (${C.yellow}${cluster.entryIds.length} prompts${C.reset})`);

    const examples = cluster.entryIds.slice(0, limitPerCluster);
    examples.forEach(id => {
      const entry = db.getById(id);
      if (entry) {
        const preview = entry.prompt.replace(/\n/g, ' ').slice(0, 80);
        console.log(`  ${C.gray}#${entry.id}${C.reset}  ${preview}`);
      }
    });
    if (cluster.entryIds.length > limitPerCluster) {
      console.log(`  ${C.gray}... and ${cluster.entryIds.length - limitPerCluster} more${C.reset}`);
    }
  });
  console.log();
}
