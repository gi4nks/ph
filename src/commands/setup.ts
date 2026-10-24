import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type HookFile = 'settings.json' | 'hooks.json';
type JsonObject = Record<string, unknown>;

const hookDefinitions: Record<string, { directory: string; file: HookFile; event: string; script: string }> = {
  claude: { directory: '.claude', file: 'settings.json', event: 'Stop', script: 'claude/ph-hook.sh' },
  codex: { directory: '.codex', file: 'hooks.json', event: 'Stop', script: 'codex/ph-hook.sh' },
  gemini: { directory: '.gemini', file: 'settings.json', event: 'AfterAgent', script: 'gemini/ph-hook.sh' },
};
const supportedTools = ['claude', 'codex', 'gemini', 'opencode'];
export type SetupStatus = 'installed' | 'updated' | 'already-configured';
export interface SetupResult { tool: string; status: SetupStatus }

export function detectCaptureTools(pathValue = process.env.PATH ?? ''): string[] {
  const directories = pathValue.split(path.delimiter).filter(Boolean);
  return supportedTools.filter(tool => directories.some(directory => {
    const binary = path.join(directory, tool);
    try { fs.accessSync(binary, fs.constants.X_OK); return true; } catch { return false; }
  }));
}

/** Install capture hooks into the user's existing AI CLI configuration. */
export function setupCapture(home = process.env.HOME ?? '', hooksRoot = defaultHooksRoot(), tools = supportedTools): SetupResult[] {
  if (!home) throw new Error('Cannot determine the home directory.');
  const results: SetupResult[] = [];
  const destination = path.join(home, '.ph', 'hooks');
  fs.mkdirSync(destination, { recursive: true });

  for (const tool of tools) {
    if (tool === 'opencode') {
      const source = path.join(hooksRoot, 'opencode/ph-plugin.ts');
      if (!fs.existsSync(source)) throw new Error(`Hook script not found: ${source}`);
      const plugin = path.join(home, '.config/opencode/plugins/ph-plugin.ts');
      fs.mkdirSync(path.dirname(plugin), { recursive: true });
      if (fs.existsSync(plugin)) {
        if (fs.readFileSync(plugin, 'utf8') !== fs.readFileSync(source, 'utf8')) {
          throw new Error(`Refusing to overwrite existing OpenCode plugin: ${plugin}`);
        }
        results.push({ tool, status: 'already-configured' });
      } else {
        fs.copyFileSync(source, plugin);
        results.push({ tool, status: 'installed' });
      }
      continue;
    }
    const definition = hookDefinitions[tool];
    if (!definition) continue;
    const source = path.join(hooksRoot, definition.script);
    if (!fs.existsSync(source)) throw new Error(`Hook script not found: ${source}`);
    const targetScript = path.join(destination, `${tool}-ph-hook.sh`);
    const scriptExists = fs.existsSync(targetScript);
    const scriptChanged = !scriptExists || fs.readFileSync(targetScript, 'utf8') !== fs.readFileSync(source, 'utf8');
    if (scriptChanged) fs.copyFileSync(source, targetScript);
    fs.chmodSync(targetScript, 0o755);

    const configPath = path.join(home, definition.directory, definition.file);
    const config = readConfig(configPath);
    if (config.hooks !== undefined && (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks))) {
      throw new Error(`Cannot safely update ${configPath}: hooks must be an object`);
    }
    const hooks = asObject(config.hooks);
    const currentEvent = hooks[definition.event];
    if (currentEvent !== undefined && !Array.isArray(currentEvent)) {
      throw new Error(`Cannot safely update ${configPath}: hooks.${definition.event} must be an array`);
    }
    const entries = (currentEvent ?? []) as unknown[];
    const command = `${targetScript}`;
    const configured = entries.some(entry => JSON.stringify(entry).includes(command));
    if (!configured) {
      const hook = { type: 'command', command };
      const entry = tool === 'codex'
        ? { hooks: [hook] }
        : { ...(tool === 'claude' ? { matcher: '.*' } : {}), hooks: [{ ...hook, ...(tool === 'claude' ? { async: true } : {}) }] };
      hooks[definition.event] = [...entries, entry];
      config.hooks = hooks;
      writeConfig(configPath, config);
    }
    results.push({
      tool,
      status: configured ? (scriptChanged ? 'updated' : 'already-configured') : 'installed',
    });
  }
  return results;
}

export function defaultHooksRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [path.resolve(here, '../../hooks'), path.resolve(here, '../hooks')].find(candidate => fs.existsSync(candidate))
    ?? path.resolve(here, '../../hooks');
}

function readConfig(file: string): JsonObject {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root must be an object');
    return parsed as JsonObject;
  } catch (error) {
    throw new Error(`Cannot safely update ${file}: ${(error as Error).message}`);
  }
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function writeConfig(file: string, config: JsonObject): void {
  const target = fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink() ? fs.realpathSync(file) : file;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.ph-tmp`;
  const mode = fs.existsSync(target) ? fs.statSync(target).mode & 0o777 : 0o600;
  fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode });
  fs.renameSync(temp, target);
}

