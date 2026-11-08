import { describe, expect, it } from 'vitest';
import { gitEnv, redact, remoteKey, sameRemote } from './git.js';

describe('git helpers', () => {
  it('redacts credentials in URLs and token values', () => {
    expect(redact('https://user:ghp_abc123456@github.com/me/edu-vault.git')).toBe('https://***@github.com/me/edu-vault.git');
    expect(redact('fatal: unable to access \'https://x-access-token:tok@github.com/a/b\'')).toBe('fatal: unable to access \'https://***@github.com/a/b\'');
    expect(redact('https://github.com/me/edu-vault.git')).toBe('https://github.com/me/edu-vault.git');
    expect(redact('token ghp_abcdefgh1234 leaked', { GH_TOKEN: 'ghp_abcdefgh1234' })).toBe('token *** leaked');
  });

  it('compares remotes across forms', () => {
    expect(sameRemote('git@github.com:me/edu-vault.git', 'https://github.com/me/edu-vault')).toBe(true);
    expect(sameRemote('https://u:t@GitHub.com/me/edu-vault.git/', 'ssh://git@github.com/me/edu-vault')).toBe(true);
    expect(sameRemote('https://github.com/me/edu-vault', 'https://github.com/me/other')).toBe(false);
    expect(remoteKey('/tmp/x/remote.git/')).toBe('/tmp/x/remote');
    expect(remoteKey('C:\\vault\\remote.git')).toBe('C:/vault/remote');
  });

  it('answers github.com credentials from GH_TOKEN without embedding it', () => {
    const env = gitEnv({ GH_TOKEN: 'ghp_secretvalue', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c' });
    expect(env.GIT_CONFIG_COUNT).toBe('2');
    expect(env.GIT_CONFIG_KEY_1).toBe('credential.https://github.com.helper');
    expect(env.GIT_CONFIG_VALUE_1).not.toContain('ghp_secretvalue');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(gitEnv({}).GIT_CONFIG_COUNT).toBeUndefined();
  });
});
