import { PhDB } from '../db/index.js';

export async function cmdVacuum(db: PhDB): Promise<void> {
  process.stdout.write('Compacting database (VACUUM)... ');
  const start = Date.now();
  db.vacuum();
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`Done in ${elapsed}s.`);
}
