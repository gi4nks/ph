import { PhDB } from '../db/index.js';
import { printResults } from '../display/print.js';

export async function cmdLast(db: PhDB, args: string[]): Promise<void> {
  const n = parseInt(args[0] ?? '10', 10);
  const results = db.search({ limit: isNaN(n) ? 10 : n });
  printResults(results, false);
}
