import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * GWT wiring for SPEC-015 (config) — load/save against a stubbed HOME.
 * os.homedir() respects $HOME on POSIX; CONFIG_PATH is computed at module
 * load, so we reset modules + stub env before each dynamic import.
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-config-'));

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function freshConfig() {
  vi.resetModules();
  vi.stubEnv('HOME', tmp);
  fs.mkdirSync(tmp, { recursive: true }); // afterEach removes it between tests
  return await import('../index.js');
}

describe('config load/save (SPEC-015)', () => {
  it('load returns {} for a missing config file (G2)', async () => {
    const { load } = await freshConfig();
    expect(load()).toEqual({});
  });

  it('save then load roundtrips values', async () => {
    const { load, save } = await freshConfig();
    save({ backgroundAnalysis: true, remoteUrl: 'http://example:3001', filterMinLength: 20 });
    const cfg = load();
    expect(cfg.backgroundAnalysis).toBe(true);
    expect(cfg.remoteUrl).toBe('http://example:3001');
    expect(cfg.filterMinLength).toBe(20);
  });

  it('save preserves previously set keys (caller merges like the config command)', async () => {
    const { load, save } = await freshConfig();
    save({ ...load(), ollamaModel: 'llama3.2:latest' });
    save({ ...load(), ollamaUrl: 'http://inference-service:11434' });
    const cfg = load();
    expect(cfg.ollamaModel).toBe('llama3.2:latest');
    expect(cfg.ollamaUrl).toBe('http://inference-service:11434');
  });

  it('load tolerates a corrupt config file', async () => {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, '.ph_config.json'), '{not valid json');
    const { load } = await freshConfig();
    expect(load()).toEqual({});
  });

  it('loads legacy oMLX settings, prefers canonical settings, and saves only canonical names', async () => {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, '.ph_config.json'), JSON.stringify({
      analyzeProvider: 'mlx-serve',
      mlxServeModel: 'legacy-model',
      mlxServeUrl: 'http://legacy.example/v1',
      mlxServeApiKey: 'legacy-key',
      omlxModel: 'canonical-model',
    }));
    const { load, save } = await freshConfig();
    const loaded = load();
    expect(loaded.analyzeProvider).toBe('omlx');
    expect(loaded.omlxModel).toBe('canonical-model');
    expect(loaded.omlxUrl).toBe('http://legacy.example/v1');
    expect(loaded.omlxApiKey).toBe('legacy-key');

    save(loaded);
    const persisted = JSON.parse(fs.readFileSync(path.join(tmp, '.ph_config.json'), 'utf-8'));
    expect(persisted).toMatchObject({ analyzeProvider: 'omlx', omlxModel: 'canonical-model', omlxUrl: 'http://legacy.example/v1', omlxApiKey: 'legacy-key' });
    expect(persisted).not.toHaveProperty('mlxServeModel');
    expect(persisted).not.toHaveProperty('mlxServeUrl');
    expect(persisted).not.toHaveProperty('mlxServeApiKey');
  });

  it('cmdConfig supports set/get with kebab-case, camelCase, retention keys, and redacts secrets', async () => {
    vi.resetModules();
    vi.stubEnv('HOME', tmp);
    fs.mkdirSync(tmp, { recursive: true });
    const { cmdConfig } = await import('../../commands/config.js');
    const { load } = await import('../index.js');

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    try {
      await cmdConfig(['set', 'backgroundAnalysis', 'true']);
      await cmdConfig(['set', 'retention-days', '45']);
      await cmdConfig(['set', 'remote-url', 'https://remote.example']);
      await cmdConfig(['set', 'remote-api-key', 'remote-secret']);
      await cmdConfig(['set', 'ollama-url', 'http://localhost:11434']);
      await cmdConfig(['set', 'gemini-api-key', 'super-secret-key']);
      await cmdConfig(['set', 'mlx-serve-model', 'legacy-accepted-model']);
      await cmdConfig(['set', 'mlx-serve-api-key', 'legacy-test-key']);
      await cmdConfig(['set', 'analyze-provider', 'mlx-serve']);

      await expect(cmdConfig(['set', 'remote-url', 'not a URL'])).rejects.toThrow(/absolute HTTP or HTTPS/i);

      expect(load()).toMatchObject({
        backgroundAnalysis: true,
        retentionDays: 45,
        remoteUrl: 'https://remote.example',
        remoteApiKey: 'remote-secret',
        ollamaUrl: 'http://localhost:11434',
        geminiApiKey: 'super-secret-key',
        omlxModel: 'legacy-accepted-model',
        omlxApiKey: 'legacy-test-key',
        analyzeProvider: 'omlx',
      });

      logs.length = 0;
      await cmdConfig(['get', 'background-analysis']);
      await cmdConfig(['get', 'retentionDays']);
      await cmdConfig(['get', 'geminiApiKey']);
      await cmdConfig(['get', 'remote-api-key']);
      await cmdConfig(['get', 'ollama-url']);
      await cmdConfig(['get', 'ollama-model']);
      await cmdConfig(['get', 'omlx-api-key']);
      await cmdConfig(['get', 'mlx-serve-api-key']);

      expect(logs).toEqual(['true', '45', '[redacted]', '[redacted]', 'http://localhost:11434', '(not set)', '[redacted]', '[redacted]']);
    } finally {
      spy.mockRestore();
    }
  });
});
