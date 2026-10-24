import { PhDB } from '../db/index.js';
import { parseFlags } from './_utils.js';
import { formatInteractionDetail, formatInteractionJson, formatInteractionMarkdown } from '../interaction/detail.js';

export async function cmdExport(db: PhDB, args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const id = parseInt(positional[0] ?? '', 10);

  if (isNaN(id)) {
    process.stderr.write('Usage: ph export <id> [--format txt|json|md] [--archive]\n');
    process.exit(1);
  }

  const entry = flags.archive ? db.getArchivedById(id) : db.getById(id);
  if (!entry) {
    process.stderr.write(`ph: prompt #${id} not found\n`);
    process.exit(1);
  }

  const format = (flags['format'] as string) ?? 'txt';

  switch (format) {
    case 'txt':
    case 'text':
      process.stdout.write(formatInteractionDetail(entry));
      break;

    case 'json': {
      process.stdout.write(formatInteractionJson(entry) + '\n');
      break;
    }

    case 'md':
    case 'markdown': {
      process.stdout.write(formatInteractionMarkdown(entry));
      break;
    }

    default:
      process.stderr.write(`ph: unknown format "${format}" — use txt, json, or md\n`);
      process.exit(1);
  }
}
