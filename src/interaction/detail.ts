import type { PromptEntry, PromptMetadata } from '../types.js';

export type InteractionAnalysisStatus = 'pending' | 'complete' | 'failed' | 'not analyzed';

export interface InteractionDetail extends Omit<PromptEntry, 'metadata'> {
  metadata: PromptMetadata;
  analysis: {
    status: InteractionAnalysisStatus;
    error?: PromptMetadata['analysis_error'];
    summary?: string;
    key_insights: string[];
    technical_decisions: string[];
    quality?: number;
    relevance?: number;
  };
}

const ANALYSIS_FIELDS: Array<keyof PromptMetadata> = [
  'summary', 'key_insights', 'technical_decisions', 'quality', 'relevance',
];

export function decodePromptMetadata(raw: string): PromptMetadata {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as PromptMetadata
      : {};
  } catch {
    return {};
  }
}

export function toInteractionDetail(entry: PromptEntry): InteractionDetail {
  const metadata = decodePromptMetadata(entry.metadata);
  const hasAnalysis = ANALYSIS_FIELDS.some(key => {
    const value = metadata[key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined;
  });
  const status = metadata.analysis_status ?? (hasAnalysis ? 'complete' : 'not analyzed');

  return {
    id: entry.id,
    timestamp: entry.timestamp,
    tool: entry.tool,
    prompt: entry.prompt,
    response: entry.response,
    args: entry.args,
    workdir: entry.workdir,
    hostname: entry.hostname,
    exit_code: entry.exit_code,
    metadata,
    analysis: {
      status,
      ...(metadata.analysis_error ? { error: metadata.analysis_error } : {}),
      ...(metadata.summary ? { summary: metadata.summary } : {}),
      key_insights: metadata.key_insights ?? [],
      technical_decisions: metadata.technical_decisions ?? [],
      ...(metadata.quality !== undefined ? { quality: metadata.quality } : {}),
      ...(metadata.relevance !== undefined ? { relevance: metadata.relevance } : {}),
    },
  };
}

export function formatInteractionDetail(entry: PromptEntry): string {
  const detail = toInteractionDetail(entry);
  const meta = detail.metadata;
  const lines = [
    `Interaction #${detail.id}`,
    `Tool: ${detail.tool}`,
    `Date: ${detail.timestamp}`,
    `Project: ${meta.project ?? '(unknown)'}`,
    `Language: ${meta.language ?? '(unknown)'}`,
    `Role: ${meta.role ?? '(unclassified)'}`,
    `Tags: ${meta.tags?.join(', ') || '(none)'}`,
    `Workdir: ${detail.workdir || '(unknown)'}`,
    `Host: ${detail.hostname || '(unknown)'}`,
    `Exit code: ${detail.exit_code}`,
    `Response captured: ${detail.response ? 'yes' : 'no'}`,
    `Analysis: ${detail.analysis.status}${detail.analysis.error ? ` (${detail.analysis.error})` : ''}`,
  ];

  if (detail.analysis.summary) lines.push('', 'Analysis summary:', detail.analysis.summary);
  if (detail.analysis.relevance !== undefined) lines.push(`Relevance: ${detail.analysis.relevance}/10`);
  if (detail.analysis.quality !== undefined) lines.push(`Quality: ${detail.analysis.quality}/10`);
  if (detail.analysis.key_insights.length) {
    lines.push('', 'Key insights:', ...detail.analysis.key_insights.map(value => `- ${value}`));
  }
  if (detail.analysis.technical_decisions.length) {
    lines.push('', 'Technical decisions:', ...detail.analysis.technical_decisions.map(value => `- ${value}`));
  }
  if (meta.git_context) {
    lines.push('', 'Git context:', `Branch: ${meta.git_context.branch}`);
    if (meta.git_context.files.length) lines.push(`Files: ${meta.git_context.files.join(', ')}`);
    if (meta.git_context.diff) lines.push(meta.git_context.diff);
  }

  const known = new Set<string>([
    '$schema_version', 'title', 'project', 'language', 'role', 'tags', 'starred',
    'relevance', 'quality', 'technical_decisions', 'git_context', 'summary',
    'key_insights', 'analysis_status', 'analysis_error', 'remote_sync_status',
    'remote_sync_error', 'remote_sync_target', 'capture_status', 'capture_owner_pid',
  ]);
  const additional = Object.fromEntries(Object.entries(meta).filter(([key]) => !known.has(key)));
  if (Object.keys(additional).length) lines.push('', 'Additional metadata:', JSON.stringify(additional, null, 2));

  lines.push('', 'Prompt:', detail.prompt || '(empty)', '', 'Response:', detail.response || '(No response captured)');
  return lines.join('\n');
}

export function formatInteractionMarkdown(entry: PromptEntry): string {
  const detail = toInteractionDetail(entry);
  const meta = detail.metadata;
  const lines = [
    `# Interaction #${detail.id}`,
    '',
    `- **Tool**: ${detail.tool}`,
    `- **Date**: ${detail.timestamp}`,
    `- **Project**: ${meta.project ?? '(unknown)'}`,
    `- **Language**: ${meta.language ?? '(unknown)'}`,
    `- **Role**: ${meta.role ?? '(unclassified)'}`,
    `- **Tags**: ${meta.tags?.join(', ') || '(none)'}`,
    `- **Workdir**: ${detail.workdir || '(unknown)'}`,
    `- **Host**: ${detail.hostname || '(unknown)'}`,
    `- **Exit code**: ${detail.exit_code}`,
    `- **Analysis**: ${detail.analysis.status}${detail.analysis.error ? ` (${detail.analysis.error})` : ''}`,
    '',
    '## Prompt',
    '',
    detail.prompt || '(empty)',
    '',
    '## Response',
    '',
    detail.response || '(No response captured)',
    '',
    '## Analysis',
    '',
    detail.analysis.summary ?? '(No summary)',
    '',
    `**Relevance**: ${detail.analysis.relevance === undefined ? '(not scored)' : `${detail.analysis.relevance}/10`}`,
    `**Quality**: ${detail.analysis.quality === undefined ? '(not scored)' : `${detail.analysis.quality}/10`}`,
    '',
    '### Key insights',
    '',
    ...(detail.analysis.key_insights.length ? detail.analysis.key_insights.map(value => `- ${value}`) : ['(None)']),
    '',
    '### Technical decisions',
    '',
    ...(detail.analysis.technical_decisions.length ? detail.analysis.technical_decisions.map(value => `- ${value}`) : ['(None)']),
    '',
    '## Metadata',
    '',
    '```json',
    JSON.stringify(meta, null, 2),
    '```',
    '',
  ];
  return lines.join('\n');
}

export function formatInteractionJson(entry: PromptEntry): string {
  return JSON.stringify(toInteractionDetail(entry), null, 2);
}
