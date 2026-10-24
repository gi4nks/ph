import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setupCapture } from '../setup.js';

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
});
