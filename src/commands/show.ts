import { PhDB } from '../db/index.js';
import { parseFlags } from './_utils.js';
import { formatInteractionDetail, formatInteractionJson } from '../interaction/detail.js';

export async function cmdShow(db: PhDB, args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const id = Number(positional[0]);
  if (!Number.isInteger(id) || id < 1) {
    process.stderr.write('Usage: ph show <id> [--json] [--archive]\n');
    process.exitCode = 2;
    return;
  }

  const entry = flags.archive ? db.getArchivedById(id) : db.getById(id);
  if (!entry) {
    process.stderr.write(`ph: ${flags.archive ? 'archived ' : ''}interaction #${id} not found\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(flags.json
    ? `${formatInteractionJson(entry)}\n`
    : `${formatInteractionDetail(entry)}\n`);
}
