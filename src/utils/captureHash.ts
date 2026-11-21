import { createHash } from 'node:crypto';

export interface CaptureHashInput {
  tool: string;
  workdir?: string | null;
  prompt: string;
  response?: string | null;
}

export function captureHash(input: CaptureHashInput): string {
  const tool = (input.tool ?? '').trim().toLowerCase();
  const workdir = (input.workdir ?? '').trim();
  const prompt = (input.prompt ?? '').trim().toLowerCase();
  const response = (input.response ?? '').trim();
  return createHash('sha256')
    .update(`${tool}\u0000${workdir}\u0000${prompt}\u0000${response}`)
    .digest('hex');
}
