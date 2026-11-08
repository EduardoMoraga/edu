import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { git, gitEnv, redact, remoteKey, sameRemote, withoutCredentials } from './git.js';

describe('git runner', () => {
  it('closes stdin: a Git child that reads input gets EOF instead of waiting', async () => {
    const started = Date.now();
    const result = await git(tmpdir(), ['-c', 'alias.readin=!cat', 'readin'], process.env, { timeoutMs: 5000 });
    expect(result.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('kills a hung Git call and reports exit code 124', async () => {
    const started = Date.now();
    const result = await git(tmpdir(), ['-c', 'alias.hang=!sleep 5', 'hang'], process.env, { timeoutMs: 300 });
    expect(result.code).toBe(124);
    expect(result.err).toMatch(/timed out/);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('never lets Git Credential Manager prompt', () => {
    expect(gitEnv({}).GCM_INTERACTIVE).toBe('never');
  });
});

describe('credential URLs', () => {
  it('redacts credential query parameters', () => {
    expect(redact('https://host/repo.git?access_token=abc123')).toBe('https://host/repo.git?access_token=***');
    expect(redact('fatal: https://h/r.git?ref=main&private_token=xyz&sig=s1 failed')).toBe('fatal: https://h/r.git?ref=main&private_token=***&sig=*** failed');
    expect(redact('https://h/r.git?ref=main')).toBe('https://h/r.git?ref=main');
  });

  it('strips userinfo and credential parameters from a URL to store', () => {
    expect(withoutCredentials('https://x-access-token:ghp_abc@github.com/me/v.git')).toEqual({ url: 'https://github.com/me/v.git', password: 'ghp_abc', stripped: true });
    expect(withoutCredentials('https://host/repo.git?access_token=abc123&ref=x').url).toBe('https://host/repo.git?ref=x');
    expect(withoutCredentials('https://host/repo.git?token=abc123').url).toBe('https://host/repo.git');
    expect(withoutCredentials('git@github.com:me/v.git')).toEqual({ url: 'git@github.com:me/v.git', stripped: false });
    expect(withoutCredentials('ssh://git@github.com/me/v.git').url).toBe('ssh://git@github.com/me/v.git');
  });
});

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
