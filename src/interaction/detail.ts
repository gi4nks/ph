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

export interface InteractionDetailFormatOptions {
  color?: boolean;
}

const DETAIL_COLORS = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  cyan: '\u001b[36m',
  blue: '\u001b[34m',
  gray: '\u001b[90m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
};

export function formatInteractionDetail(entry: PromptEntry, options: InteractionDetailFormatOptions = {}): string {
  const detail = toInteractionDetail(entry);
  const meta = detail.metadata;
  const paint = (value: string, color: string) => options.color ? `${color}${value}${DETAIL_COLORS.reset}` : value;
  const section = (title: string) => [paint(title, `${DETAIL_COLORS.blue}${DETAIL_COLORS.bold}`), paint('─'.repeat(52), DETAIL_COLORS.gray)];
  const field = (label: string, value: string) => `  ${paint(label.padEnd(19), DETAIL_COLORS.gray)} ${value}`;
  const statusColor = detail.analysis.status === 'complete'
    ? DETAIL_COLORS.green
    : detail.analysis.status === 'failed'
      ? DETAIL_COLORS.red
      : DETAIL_COLORS.yellow;
  const lines = [
    paint(`Interaction #${detail.id}`, `${DETAIL_COLORS.cyan}${DETAIL_COLORS.bold}`),
    paint('─'.repeat(52), DETAIL_COLORS.gray),
    ...section('CAPTURE DETAILS'),
    field('Tool', detail.tool),
    field('Date', detail.timestamp),
    field('Project', meta.project ?? '(unknown)'),
    field('Language', meta.language ?? '(unknown)'),
    field('Role', meta.role ?? '(unclassified)'),
    field('Tags', meta.tags?.join(', ') || '(none)'),
    field('Workdir', detail.workdir || '(unknown)'),
    field('Host', detail.hostname || '(unknown)'),
    field('Exit code', String(detail.exit_code)),
    field('Response captured', detail.response ? 'yes' : 'no'),
    field('Analysis status', paint(detail.analysis.status, statusColor)),
  ];

  lines.push(
    '',
    ...section('PROMPT'),
    ...(detail.prompt || '(empty)').split('\n').map(line => `  ${line}`),
    '',
    ...section('RESPONSE'),
    ...(detail.response || '(No response captured)').split('\n').map(line => `  ${line}`),
  );

  const hasAnalysisDetails = Boolean(
    detail.analysis.summary || detail.analysis.error || detail.analysis.key_insights.length ||
    detail.analysis.technical_decisions.length || detail.analysis.relevance !== undefined ||
    detail.analysis.quality !== undefined,
  );
  if (hasAnalysisDetails) {
    lines.push('', ...section('ANALYSIS'));
    if (detail.analysis.summary) lines.push(...detail.analysis.summary.split('\n').map(line => `  ${line}`));
    if (detail.analysis.error) lines.push(field('Error', detail.analysis.error));
    if (detail.analysis.relevance !== undefined) lines.push(field('Relevance', `${detail.analysis.relevance}/10`));
    if (detail.analysis.quality !== undefined) lines.push(field('Quality', `${detail.analysis.quality}/10`));
  }
  if (detail.analysis.key_insights.length) {
    lines.push('', paint('Key insights', DETAIL_COLORS.cyan), ...detail.analysis.key_insights.map(value => `  • ${value}`));
  }
  if (detail.analysis.technical_decisions.length) {
    lines.push('', paint('Technical decisions', DETAIL_COLORS.cyan), ...detail.analysis.technical_decisions.map(value => `  • ${value}`));
  }
  if (meta.git_context) {
    lines.push('', ...section('GIT CONTEXT'), field('Branch', meta.git_context.branch));
    if (meta.git_context.files.length) lines.push(field('Files', meta.git_context.files.join(', ')));
    if (meta.git_context.diff) lines.push(...meta.git_context.diff.split('\n').map(line => `  ${line}`));
  }

  const known = new Set<string>([
    '$schema_version', 'title', 'project', 'language', 'role', 'tags', 'starred',
    'relevance', 'quality', 'technical_decisions', 'git_context', 'summary',
    'key_insights', 'analysis_status', 'analysis_error', 'remote_sync_status',
    'remote_sync_error', 'remote_sync_target', 'capture_status', 'capture_owner_pid',
  ]);
  const additional = Object.fromEntries(Object.entries(meta).filter(([key]) => !known.has(key)));
  if (Object.keys(additional).length) lines.push('', ...section('ADDITIONAL METADATA'), JSON.stringify(additional, null, 2));
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
