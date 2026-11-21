import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { setupCapture } from '../setup.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('ph setup', () => {
  let root = '';

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('adds capture hooks while preserving existing settings and stays idempotent', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-setup-'));
    const home = path.join(root, 'home');
    const hooks = path.join(root, 'source-hooks');
    fs.mkdirSync(path.join(hooks, 'claude'), { recursive: true });
    fs.writeFileSync(path.join(hooks, 'claude/ph-hook.sh'), '#!/bin/sh\n');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude/settings.json'), JSON.stringify({ theme: 'dark', hooks: { Stop: [{ matcher: 'other', hooks: [{ type: 'command', command: 'existing-hook' }] }] } }));

    expect(setupCapture(home, hooks, ['claude'])).toEqual([{ tool: 'claude', status: 'installed' }]);
    const configPath = path.join(home, '.claude/settings.json');
    const installedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(installedConfig.theme).toBe('dark');
    expect(installedConfig.hooks.Stop).toHaveLength(2);
    expect(fs.statSync(path.join(home, '.ph/hooks/claude-ph-hook.sh')).mode & 0o111).toBeTruthy();

    expect(setupCapture(home, hooks, ['claude'])).toEqual([{ tool: 'claude', status: 'already-configured' }]);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).hooks.Stop).toHaveLength(2);
  });

  it('does not overwrite malformed user configuration', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-setup-'));
    const home = path.join(root, 'home');
    const hooks = path.join(root, 'source-hooks');
    fs.mkdirSync(path.join(hooks, 'codex'), { recursive: true });
    fs.writeFileSync(path.join(hooks, 'codex/ph-hook.sh'), '#!/bin/sh\n');
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    const configPath = path.join(home, '.codex/hooks.json');
    fs.writeFileSync(configPath, '{broken');

    expect(() => setupCapture(home, hooks, ['codex'])).toThrow('Cannot safely update');
    expect(fs.readFileSync(configPath, 'utf8')).toBe('{broken');
  });

  it('updates an existing PH OpenCode plugin and refuses to overwrite an unrelated plugin', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-setup-'));
    const home = path.join(root, 'home');
    const hooks = path.join(root, 'source-hooks');
    fs.mkdirSync(path.join(hooks, 'opencode'), { recursive: true });
    fs.writeFileSync(path.join(hooks, 'opencode/ph-plugin.ts'), 'export const PhOpenCodePlugin = async () => ({ /* v2 */ });\n');

    const installedPlugin = path.join(home, '.config/opencode/plugins/ph-plugin.ts');
    fs.mkdirSync(path.dirname(installedPlugin), { recursive: true });
    fs.writeFileSync(installedPlugin, 'export const PhOpenCodePlugin = async () => ({ /* v1 */ });\n');

    expect(setupCapture(home, hooks, ['opencode'])).toEqual([{ tool: 'opencode', status: 'updated' }]);
    expect(fs.readFileSync(installedPlugin, 'utf8')).toContain('/* v2 */');
    expect(setupCapture(home, hooks, ['opencode'])).toEqual([{ tool: 'opencode', status: 'already-configured' }]);

    fs.writeFileSync(installedPlugin, 'export const CustomUserPlugin = async () => ({});\n');
    expect(() => setupCapture(home, hooks, ['opencode'])).toThrow('Refusing to overwrite existing OpenCode plugin');
    expect(fs.readFileSync(installedPlugin, 'utf8')).toContain('CustomUserPlugin');
  });

  it('keeps shell hook scripts free of jq and inline node -e', () => {
    for (const tool of ['claude', 'codex', 'gemini', 'agy']) {
      const script = fs.readFileSync(path.join(repoRoot, 'hooks', tool, 'ph-hook.sh'), 'utf8');
      expect(script).not.toMatch(/\bjq\b/);
      expect(script).not.toMatch(/\bnode\s+-e\b/);
      expect(script).toContain(`ph hook ${tool}`);
    }
  });
});
