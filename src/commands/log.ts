import os from 'os';
import { PhDB } from '../db/index.js';
import type { PhConfig } from '../config/index.js';
import { detectProject, detectLanguage } from '../runner/project.js';
import { extractTopic } from '../utils/extractTopic.js';
import { spawnBackgroundAnalysis } from '../background/analyzer.js';
import { parseFlags } from './_utils.js';

export async function cmdLog(dbPath: string, cfg: PhConfig, args: string[]): Promise<void> {
  let tool: string;
  let prompt: string;
  let response: string;
  let workdir: string;

  const { flags } = parseFlags(args);

  if (flags['prompt']) {
    tool     = (flags['tool']     as string) || 'unknown';
    prompt   = (flags['prompt']   as string);
    response = (flags['response'] as string) || '';
    workdir  = (flags['workdir']  as string) || process.cwd();
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    if (!raw) { process.stderr.write('ph log: no input (use --prompt or pipe JSON)\n'); process.exit(1); }
    let parsed: Record<string, string>;
    try { parsed = JSON.parse(raw) as Record<string, string>; }
    catch { process.stderr.write('ph log: invalid JSON on stdin\n'); process.exit(1); }
    tool     = parsed['tool']     || (flags['tool']    as string) || 'unknown';
    prompt   = parsed['prompt']   || '';
    response = parsed['response'] || '';
    workdir  = parsed['workdir']  || (flags['workdir'] as string) || process.cwd();
    if (!prompt) { process.stderr.write('ph log: missing "prompt" field\n'); process.exit(1); }
  }

  const { rootDir, projectName } = detectProject(workdir);
  const language = detectLanguage(rootDir);

  const metaObj: Record<string, unknown> = { $schema_version: 1 };
  if (projectName) metaObj.project = projectName;
  if (language)    metaObj.language = language;

  const title = extractTopic(prompt);
  if (title) metaObj.title = title;

  const db = new PhDB(dbPath);
  const id = db.insert({
    timestamp: new Date().toISOString(),
    tool,
    prompt,
    response,
    args: '',
    workdir,
    hostname: os.hostname(),
    exit_code: 0,
    metadata: JSON.stringify(metaObj),
  });
  db.close();

  if (cfg.backgroundAnalysis) {
    spawnBackgroundAnalysis(id, dbPath);
  }

  // Background push to remote if configured
  const pushUrl = process.env.PH_REMOTE_URL || cfg.remoteUrl;
  if (pushUrl) {
    pushToRemote(pushUrl, cfg.remoteApiKey, { timestamp: new Date().toISOString(), tool, prompt, response, args: '', workdir, hostname: os.hostname(), exit_code: 0, metadata: JSON.stringify(metaObj) }).catch(() => {});
  }
}

async function pushToRemote(url: string, apiKey: string | undefined, entry: Record<string, any>): Promise<void> {
  const res = await fetch(`${url}/api/sync/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ prompts: [entry] }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Remote push error: ${err}`);
  }
}
