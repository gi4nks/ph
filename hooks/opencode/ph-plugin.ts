import { spawn } from "node:child_process";
import type { Plugin } from "@opencode-ai/plugin";

interface PendingPrompt {
  text: string;
  timestamp: string;
  agent?: string;
  model?: string;
}

interface SessionState {
  prompt: PendingPrompt | null;
  response: string;
  flushed: boolean;
}

/** Per-session state for pairing user prompts with assistant responses */
const sessions = new Map<string, SessionState>();

function textFromParts(parts: { type?: string; text?: string }[]): string {
  try {
    return parts
      .filter(p => p.type === 'text')
      .map(p => p.text || '')
      .join('')
      .trim();
  } catch { return ''; }
}

function callPhLog(
  prompt: PendingPrompt,
  response: string,
  workdir: string,
): void {
  try {
    if (!prompt.text || !response) return;

    const payload: Record<string, unknown> = {
      tool: 'opencode',
      prompt: prompt.text,
      response,
      workdir,
    };

    const meta: Record<string, unknown> = { source: 'plugin' };
    if (prompt.agent) meta.agent = prompt.agent;
    if (prompt.model) meta.model = prompt.model;
    payload.metadata = JSON.stringify(meta);

    const json = JSON.stringify(payload);
    const child = spawn('ph', ['log'], {
      stdio: ['pipe', 'ignore', 'ignore'],
      detached: true,
    });
    child.on('error', () => {});
    child.stdin?.end(json);
    child.unref();
  } catch { /* silent */ }
}

function flushSession(sessionID: string, directory: string): void {
  const session = sessions.get(sessionID);
  if (!session || session.flushed || !session.prompt?.text || !session.response) return;
  session.flushed = true;
  callPhLog(session.prompt, session.response, directory);
}

export const PhOpenCodePlugin: Plugin = async ({ directory }) => {
  return {
    "chat.message": async (input, output) => {
      try {
        const { sessionID, agent, model } = input;
        const { message, parts } = output;
        const role = (message as Record<string, unknown>).role;

        if (role === 'user') {
          flushSession(sessionID, directory);

          const text = textFromParts(parts);
          if (text) {
            sessions.set(sessionID, {
              prompt: {
                text,
                timestamp: new Date().toISOString(),
                agent,
                model: model ? `${model.providerID}/${model.modelID}` : undefined,
              },
              response: '',
              flushed: false,
            });
          }
        } else if (role === 'assistant') {
          const existing = sessions.get(sessionID);
          if (!existing?.prompt) return;

          const text = textFromParts(parts);
          if (text) {
            sessions.set(sessionID, {
              ...existing,
              response: text,
              flushed: existing.flushed && existing.response === text,
            });
          }
        }
      } catch { /* silent */ }
    },

    "experimental.text.complete": async (input, output) => {
      try {
        const session = sessions.get(input.sessionID);
        if (!session?.prompt) return;

        if (output.text) {
          sessions.set(input.sessionID, {
            ...session,
            response: output.text,
            flushed: false,
          });
          flushSession(input.sessionID, directory);
        }
      } catch { /* silent */ }
    },

    "event": async ({ event }) => {
      try {
        if (event?.type !== 'session.idle') return;
        const properties = (event as { properties?: { sessionID?: unknown } }).properties;
        const rawSessionId = properties?.sessionID ?? (event as { sessionID?: unknown }).sessionID;
        if (typeof rawSessionId === 'string' && rawSessionId) {
          flushSession(rawSessionId, directory);
          return;
        }
        for (const sessionID of sessions.keys()) {
          flushSession(sessionID, directory);
        }
      } catch { /* silent */ }
    },
  };
};
