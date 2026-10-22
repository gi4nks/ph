import type { PromptEntry, PromptMetadata } from '../../types.js';

export function formatResultsAsMarkdown(entries: PromptEntry[]): string {
  if (entries.length === 0) return "No relevant memory found for this project.";

  return entries.map(e => {
    let meta: PromptMetadata = {};
    try { meta = JSON.parse(e.metadata); } catch {}

    let out = `### Interaction #${e.id} (${new Date(e.timestamp).toLocaleDateString()})\n`;
    if (meta.role) out += `Role: ${meta.role}  \n`;
    if (meta.summary) out += `**Summary**: ${meta.summary}\n`;
    out += `**Prompt**: ${e.prompt.slice(0, 300)}${e.prompt.length > 300 ? '...' : ''}\n`;
    if (meta.key_insights && meta.key_insights.length > 0) {
      out += `**Key Insights**:\n${meta.key_insights.map(i => `- ${i}`).join('\n')}\n`;
    }
    return out;
  }).join('\n---\n\n');
}

export function formatPromptList(entries: PromptEntry[], query?: string): string {
  if (entries.length === 0) return "No prompts found.";

  const header = query
    ? `Found ${entries.length} prompts matching "${query}":\n\n`
    : `Recent ${entries.length} prompts:\n\n`;

  return header + entries.map(e => {
    let meta: PromptMetadata = {};
    try { meta = JSON.parse(e.metadata); } catch {}

    const date = new Date(e.timestamp).toLocaleString();
    const proj = meta.project ? ` [${meta.project}]` : '';
    const title = meta.title ? ` — ${meta.title}` : '';
    const roleStr = meta.role ? `  \nRole: ${meta.role}` : '';

    let out = `### #${e.id} — ${e.tool}${proj} (${date})${title}\n`;
    if (meta.summary) out += `**Summary**: ${meta.summary}  \n`;
    out += `${roleStr}  \n`; // keep role placement consistent
    out += `**Prompt**: ${e.prompt.slice(0, 300)}${e.prompt.length > 300 ? '...' : ''}\n`;
    if (e.response) {
      out += `**Response**: ${e.response.slice(0, 200)}${e.response.length > 200 ? '...' : ''}\n`;
    }
    return out;
  }).join('\n---\n\n');
}

export function formatSinglePrompt(e: PromptEntry): string {
  let meta: PromptMetadata = {};
  try { meta = JSON.parse(e.metadata); } catch {}

  const date = new Date(e.timestamp).toLocaleString();
  const parts: string[] = [];

  parts.push(`# Prompt #${e.id}\n`);
  parts.push(`**Tool**: ${e.tool}  `);
  parts.push(`**Date**: ${date}  `);
  if (meta.project) parts.push(`**Project**: ${meta.project}  `);
  if (meta.role) parts.push(`**Role**: ${meta.role}  `);
  if (meta.title) parts.push(`**Title**: ${meta.title}  `);
  if (meta.tags?.length) parts.push(`**Tags**: ${meta.tags.join(', ')}  `);
  if (e.workdir) parts.push(`**Workdir**: ${e.workdir}  `);
  if (e.exit_code !== 0) parts.push(`**Exit Code**: ${e.exit_code}  `);
  parts.push('');

  if (meta.summary) {
    parts.push(`**Summary**: ${meta.summary}\n`);
  }

  parts.push('---\n');
  parts.push('**Prompt**:\n');
  parts.push('```\n' + e.prompt + '\n```\n');

  if (e.response) {
    parts.push('\n**Response**:\n');
    parts.push('```\n' + e.response + '\n```\n');
  }

  if (meta.key_insights?.length) {
    parts.push('\n**Key Insights**:\n');
    for (const i of meta.key_insights) parts.push(`- ${i}\n`);
  }

  return parts.join('\n');
}
