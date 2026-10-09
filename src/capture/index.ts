import os from 'node:os';
import { detectProject, detectLanguage } from '../runner/project.js';
import type { GitContext } from '../runner/git-context.js';
import { extractTopic } from '../utils/extractTopic.js';
import type { PromptEntry } from '../types.js';

export interface CaptureInput {
  tool: string;
  prompt: string;
  response?: string;
  args?: string;
  workdir: string;
  timestamp?: string;
  hostname?: string;
  exit_code?: number;
  metadata?: Record<string, unknown>;
  gitContext?: GitContext | null;
}

/** Build the canonical record shared by live capture entry points. */
export function createCaptureRecord(input: CaptureInput): Omit<PromptEntry, 'id'> {
  const { rootDir, projectName } = detectProject(input.workdir);
  const language = detectLanguage(rootDir);
  const title = extractTopic(input.prompt);
  const metadata: Record<string, unknown> = {
    $schema_version: 1,
    ...(projectName ? { project: projectName } : {}),
    ...(language ? { language } : {}),
    ...(title ? { title } : {}),
    ...(input.gitContext ? { git_context: input.gitContext } : {}),
    ...input.metadata,
  };

  return {
    timestamp: input.timestamp ?? new Date().toISOString(),
    tool: input.tool,
    prompt: input.prompt,
    response: input.response ?? '',
    args: input.args ?? '',
    workdir: input.workdir,
    hostname: input.hostname ?? os.hostname(),
    exit_code: input.exit_code ?? 0,
    metadata: JSON.stringify(metadata),
  };
}
