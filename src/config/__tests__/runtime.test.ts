import { describe, expect, it } from 'vitest';
import { resolveMemoryHubConfig, resolveRemoteSyncConfig, resolveServerAuthConfig } from '../runtime.js';

describe('runtime configuration resolution', () => {
  it('uses environment values over file config and reports partial hub setup', () => {
    expect(resolveMemoryHubConfig({ memoryHubUrl: 'https://file.test', memoryHubApiKey: 'file-key' }, {
      PH_MEMORY_HUB_URL: 'https://env.test',
    })).toEqual({ url: 'https://env.test', apiKey: 'file-key', configured: true, partial: false });
    expect(resolveMemoryHubConfig({ memoryHubUrl: 'https://file.test' }, {})).toEqual({
      url: 'https://file.test', apiKey: undefined, configured: false, partial: true,
    });
  });

  it('keeps raw-history and memory-hub credentials in separate settings', () => {
    const cfg = { remoteUrl: 'https://history.test', remoteApiKey: 'history-key', memoryHubUrl: 'https://memory.test', memoryHubApiKey: 'memory-key' };
    expect(resolveRemoteSyncConfig(cfg, { PH_REMOTE_URL: 'https://override.test' })).toEqual({ url: 'https://override.test', apiKey: 'history-key' });
    expect(resolveServerAuthConfig(cfg, { PH_SERVER_API_KEY: 'server-key' })).toEqual({ historyApiKey: 'server-key', memoryHubApiKey: 'memory-key' });
  });
});
