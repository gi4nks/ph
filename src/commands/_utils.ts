export function parseFlags(args: string[]): { flags: Record<string, string | boolean>; positional: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[i + 1];
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else {
      positional.push(a);
      i++;
    }
  }
  return { flags, positional };
}

export function parseDate(s: string, label: string): Date {
  const d = new Date(s);
  if (isNaN(d.getTime())) {
    process.stderr.write(`ph: invalid ${label} date: ${s}\n`);
    process.exit(1);
  }
  return d;
}
