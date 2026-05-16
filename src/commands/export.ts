import { PhDB } from '../db/index.js';
import type { PromptMetadata } from '../types.js';
import { parseFlags } from './_utils.js';

export async function cmdExport(db: PhDB, args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const id = parseInt(positional[0] ?? '', 10);

  if (isNaN(id)) {
    process.stderr.write('Usage: ph export <id> [--format txt|json|md]\n');
    process.exit(1);
  }

  const entry = db.getById(id);
  if (!entry) {
    process.stderr.write(`ph: prompt #${id} not found\n`);
    process.exit(1);
  }

  const format = (flags['format'] as string) ?? 'txt';

  switch (format) {
    case 'txt':
    case 'text':
      process.stdout.write(entry.prompt);
      break;

    case 'json': {
      const obj = {
        id: entry.id,
        timestamp: entry.timestamp,
        tool: entry.tool,
        prompt: entry.prompt,
        metadata: JSON.parse(entry.metadata) as unknown,
      };
      console.log(JSON.stringify(obj));
      break;
    }

    case 'md':
    case 'markdown': {
      let meta: PromptMetadata = {};
      try { meta = JSON.parse(entry.metadata) as PromptMetadata; } catch {}

      let md = `# Prompt #${entry.id}\n\n`;
      if (meta.starred) md += '★ **Starred**\n\n';
      md += `- **Tool**: ${entry.tool}\n`;
      md += `- **Date**: ${entry.timestamp}\n`;
      if (meta.project) md += `- **Project**: ${meta.project}\n`;
      if (meta.language) md += `- **Language**: ${meta.language}\n`;
      if (meta.role) md += `- **Role**: ${meta.role}\n`;
      if (meta.tags && meta.tags.length > 0) md += `- **Tags**: ${meta.tags.join(', ')}\n`;
      md += `- **Dir**: ${entry.workdir}\n\n---\n\n## Prompt\n\n${entry.prompt}\n`;

      if (entry.response) {
        md += `\n## Response\n\n${entry.response}\n`;
      }

      if (meta.git_context) {
        md += `\n## Git Context\n\n`;
        md += `**Branch**: ${meta.git_context.branch}\n`;
        if (meta.git_context.files.length > 0) {
          md += `**Modified files**: ${meta.git_context.files.join(', ')}\n`;
        }
        md += `\n\`\`\`diff\n${meta.git_context.diff}\n\`\`\`\n`;
      }

      process.stdout.write(md);
      break;
    }

    default:
      process.stderr.write(`ph: unknown format "${format}" — use txt, json, or md\n`);
      process.exit(1);
  }
}
