import type { IPtyProcess } from '@lydell/node-pty';
import fs from 'fs';
import { StringDecoder } from 'node:string_decoder';

export type PromptCallback = (prompt: string, timestamp: Date) => number; // returns prompt ID
export type ResponseCallback = (id: number, response: string) => void;

function cleanLine(bytes: number[]): string {
  const s = Buffer.from(bytes).toString('utf-8');
  return s.trim();
}

/**
 * Strips ANSI escape codes and PTY noise from a string.
 */
export function stripPtyControlSequences(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

// ESC sequence state machine states
type EscState = 'NORMAL' | 'ESC' | 'CSI' | 'OSC';

export async function runPTY(
  binary: string,
  args: string[],
  onPrompt: PromptCallback,
  onResponse: ResponseCallback,
  debugLog?: string
): Promise<number> {
  let dbgStream: fs.WriteStream | null = null;
  if (debugLog) {
    dbgStream = fs.createWriteStream(debugLog, { flags: 'a' });
    dbgStream.write(`\n=== session start: ${binary} ${args.join(' ')} @ ${new Date().toISOString()} ===\n`);
  }

  const log = (msg: string) => {
    if (dbgStream) dbgStream.write(`[${new Date().toISOString()}] ${msg}\n`);
  };

  let pty: typeof import('@lydell/node-pty').default;
  try {
    const mod = await import('@lydell/node-pty');
    pty = (typeof mod.spawn === 'function' ? mod : mod.default) as typeof import('@lydell/node-pty').default;
  } catch (error) {
    throw new Error(
      `Interactive PTY capture requires optional dependency "@lydell/node-pty": ${(error as Error).message}`
    );
  }
  if (!pty || typeof pty.spawn !== 'function') {
    throw new Error('Interactive PTY capture requires optional dependency "@lydell/node-pty".');
  }

  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  const ptyProcess: IPtyProcess = pty.spawn(binary, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
  });

  let currentPromptId: number | null = null;
  let responseBuffer = '';

  // Forward PTY output to stdout and capture for response
  ptyProcess.onData((data: string) => {
    process.stdout.write(data);
    if (currentPromptId !== null) {
      responseBuffer += data;
    }
  });

  // Resize on SIGWINCH
  const onResize = () => {
    ptyProcess.resize(process.stdout.columns || 80, process.stdout.rows || 24);
  };
  process.stdout.on('resize', onResize);

  // Set stdin to raw mode for byte-level interception
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  let lineBuffer: number[] = [];
  let escState: EscState = 'NORMAL';
  const utf8Decoder = new StringDecoder('utf8');

  const onData = (chunk: Buffer) => {
    // Decode UTF-8 chunks across multi-byte boundaries before forwarding to the PTY
    const decoded = utf8Decoder.write(chunk);
    if (decoded) {
      ptyProcess.write(decoded);
    }

    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i];
      // log(`byte: 0x${b.toString(16).padStart(2, '0')} state:${escState} line:${JSON.stringify(Buffer.from(lineBuffer).toString())}`);

      switch (escState) {
        case 'NORMAL':
          if (b === 13 || b === 10) {
            // Enter — capture prompt
            const prompt = cleanLine(lineBuffer);
            log(`ENTER → prompt: ${JSON.stringify(prompt)}`);
            if (prompt) {
              // If we have a previous prompt, finalize its response now
              if (currentPromptId !== null) {
                onResponse(currentPromptId, stripPtyControlSequences(responseBuffer));
              }
              currentPromptId = onPrompt(prompt, new Date());
              responseBuffer = '';
            }
            lineBuffer = [];
          } else if (b === 127 || b === 8) {
            // Backspace
            if (lineBuffer.length > 0) lineBuffer.pop();
          } else if (b === 3 || b === 4) {
            // Ctrl-C / Ctrl-D — discard line
            lineBuffer = [];
          } else if (b === 27) {
            // ESC — start escape sequence
            escState = 'ESC';
          } else if (b >= 32) {
            lineBuffer.push(b);
          }
          break;

        case 'ESC':
          if (b === 0x5b) {
            // '[' → CSI sequence
            escState = 'CSI';
          } else if (b === 0x5d || b === 0x50 || b === 0x5f || b === 0x5e || b === 0x58) {
            // ']', 'P', '_', '^', 'X' → OSC/DCS/APC/PM/SOS
            escState = 'OSC';
          } else {
            // 2-char ESC sequence, done
            escState = 'NORMAL';
          }
          break;

        case 'CSI':
          // CSI ends at first letter (A-Z, a-z) or '~'
          if ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x7e) {
            escState = 'NORMAL';
          }
          break;

        case 'OSC':
          // OSC ends at BEL (0x07)
          if (b === 0x07) {
            escState = 'NORMAL';
          } else if (b === 0x1b) {
            // ESC \ (ST) — the '\' will come as the next byte; transition to absorb it
            escState = 'ESC';
          }
          break;
      }
    }
  };

  process.stdin.on('data', onData);

  return new Promise<number>((resolve) => {
    ptyProcess.onExit(({ exitCode }) => {
      // Finalize last response
      if (currentPromptId !== null) {
        onResponse(currentPromptId, stripPtyControlSequences(responseBuffer));
      }

      // Cleanup
      utf8Decoder.end();
      process.stdin.removeListener('data', onData);
      process.stdout.removeListener('resize', onResize);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      if (dbgStream) {
        dbgStream.write(`=== session end exitCode=${exitCode} ===\n`);
        dbgStream.end();
      }
      resolve(exitCode);
    });
  });
}

export function isTerminal(): boolean {
  return Boolean(process.stdin.isTTY);
}
