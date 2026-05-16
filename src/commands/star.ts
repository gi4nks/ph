import { PhDB } from '../db/index.js';
import type { PromptMetadata } from '../types.js';

export async function cmdStar(db: PhDB, args: string[]): Promise<void> {
  const id = parseInt(args[0] ?? '', 10);
  if (isNaN(id)) {
    process.stderr.write('Usage: ph star <id>\n');
    process.exit(1);
  }

  const entry = db.getById(id);
  if (!entry) {
    process.stderr.write(`ph: prompt #${id} not found\n`);
    process.exit(1);
  }

  let meta: PromptMetadata = {};
  try { meta = JSON.parse(entry.metadata) as PromptMetadata; } catch {}

  const wasStarred = Boolean(meta.starred);
  meta.starred = !wasStarred;

  db.updateMetadata(id, JSON.stringify(meta));

  if (meta.starred) {
    console.log(`Prompt #${id} starred ★`);
  } else {
    console.log(`Prompt #${id} unstarred`);
  }
}
