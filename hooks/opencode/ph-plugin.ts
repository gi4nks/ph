import type { Plugin } from "@opencode-ai/plugin";

interface PendingPrompt {
  text: string;
  timestamp: string;
  agent?: string;
  model?: string;
}

/** Per-session state for pairing user prompts with assistant responses */
const sessions = new Map<string, {
  prompt: PendingPrompt | null;
  response: string;
}>();

function textFromParts(parts: { type?: string; text?: string }[]): string {
  return parts
    .filter(p => p.type === 'text')
    .map(p => p.text || '')
    .join('')
    .trim();
}

async function callPhLog(
  $: any,
  prompt: PendingPrompt,
  response: string,
  workdir: string,
): Promise<void> {
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
  const _ = $`echo ${json} | ph log > /dev/null 2>&1`;
  _.then(() => {}).catch(() => {});
}

export const PhOpenCodePlugin: Plugin = async ({ directory, $ }) => {
  return {
    "chat.message": async (input, output) => {
      const { sessionID, agent, model } = input;
      const { message, parts } = output;
      const role = (message as Record<string, unknown>).role;

      if (role === 'user') {
        const existing = sessions.get(sessionID);
        const prompt = existing?.prompt;
        const response = existing?.response;

        // Log previous turn if we have both parts
        if (prompt && response) {
          await callPhLog($, prompt, response, directory);
        }

        // Store new prompt, reset response
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
          });
        }
      } else if (role === 'assistant') {
        const existing = sessions.get(sessionID);
        if (!existing?.prompt) return;

        // Snapshot whatever text is available (non-streaming or initial frame)
        const text = textFromParts(parts);
        if (text) {
          sessions.set(sessionID, { ...existing, response: text });
        }
      }
    },

    "experimental.text.complete": async (input, output) => {
      const session = sessions.get(input.sessionID);
      if (!session?.prompt) return;

      // Replace with complete text (handles streaming: this fires after streaming ends)
      if (output.text) {
        sessions.set(input.sessionID, { ...session, response: output.text });
      }
    },
  };
};
