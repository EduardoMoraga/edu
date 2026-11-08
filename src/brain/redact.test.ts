import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openBrain } from './brain.js';
import { resetLedgerCache } from './ledger.js';
import { redactSecrets } from './redact.js';
import { resetNoteCache } from './store.js';

const dirs: string[] = [];
async function temp() { const path = await mkdtemp(join(tmpdir(), 'edu-redact-')); dirs.push(path); return path; }
afterEach(async () => { resetNoteCache(); resetLedgerCache(); await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

// Fake secrets assembled at runtime so no scanner mistakes this file for a leak.
const j = (...parts: string[]) => parts.join('');
const rnd = 'Q7xK2mP9vL4nR8tW3yZ6bC1dF5gH0jS';
const FAKE = {
  anthropic: j('sk-', 'ant-', 'api03-', rnd, 'abc'),
  openai: j('sk-', 'proj-', rnd, 'xyz'),
  github: j('gh', 'p_', rnd, 'Ab12C'),
  githubPat: j('github', '_pat_', '11ABCDE', rnd),
  gitlab: j('gl', 'pat-', rnd.slice(0, 20)),
  slack: j('xo', 'xb-', '1234567890-', rnd.slice(0, 12)),
  aws: j('AK', 'IA', 'IOSFODNN7EXAMPLE'),
  google: j('AI', 'za', 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'),
  jwt: j('eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJ', 'zdWIiOiIxMjM0NTY3ODkwIn0', '.', 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'),
  pem: j('-----BEGIN ', 'RSA PRIVATE KEY-----\n', 'MIIEowIBAAKCAQEA', rnd, '\n-----END ', 'RSA PRIVATE KEY-----'),
};

describe('redactSecrets', () => {
  it.each([
    ['anthropic-key', `use ${FAKE.anthropic} here`],
    ['openai-key', `key ${FAKE.openai}.`],
    ['github-token', `clone with ${FAKE.github}`],
    ['github-token', `pat ${FAKE.githubPat}`],
    ['gitlab-token', `ci ${FAKE.gitlab}`],
    ['slack-token', `bot ${FAKE.slack}`],
    ['aws-access-key', `aws ${FAKE.aws}`],
    ['google-api-key', `maps ${FAKE.google}`],
    ['jwt', `cookie ${FAKE.jwt}`],
    ['private-key', `key:\n${FAKE.pem}\nend`],
  ])('redacts %s', (kind, text) => {
    const result = redactSecrets(text);
    expect(result.kinds).toContain(kind);
    expect(result.text).toContain(`[REDACTED:${kind}]`);
    for (const secret of Object.values(FAKE)) expect(result.text).not.toContain(secret);
  });

  it('keeps the key or user and replaces only the secret in assignments, bearer headers and connection strings', () => {
    expect(redactSecrets('DB_PASSWORD=hunter2!x').text).toBe('DB_PASSWORD=[REDACTED:assignment]');
    expect(redactSecrets('"api_key": "abcd1234efgh"').text).toBe('"api_key": "[REDACTED:assignment]"');
    expect(redactSecrets('token: s3cr3tvalue and more').text).toBe('token: [REDACTED:assignment] and more');
    expect(redactSecrets(`Authorization: Bearer ${rnd}`).text).toBe('Authorization: Bearer [REDACTED:bearer-token]');
    expect(redactSecrets('postgres://admin:pa55word@db.example.com:5432/app').text).toBe('postgres://admin:[REDACTED:connection-string]@db.example.com:5432/app');
    expect(redactSecrets(`the api key is ${rnd}9`).text).toBe('the api key is [REDACTED:high-entropy]');
  });

  it('leaves prose, placeholders and earlier redactions alone (and is idempotent)', () => {
    for (const text of [
      'Rotate the password every quarter; never share a token.',
      'password=${DB_PASSWORD} token=<your-token> secret: changeme api_key=process.env.API_KEY',
      'compass: north, bypass=yes, max_tokens is 4096',
      'Use basic authentication with internationalization support',
      'postgres://user:${PASSWORD}@host/db',
      'https://example.com/path?x=1',
    ]) expect(redactSecrets(text)).toEqual({ text, kinds: [] });
    const once = redactSecrets(`token=${FAKE.github} and ${FAKE.anthropic}`);
    expect(once.kinds).toEqual(['anthropic-key', 'github-token']);
    expect(redactSecrets(once.text)).toEqual({ text: once.text, kinds: [] });
  });
});

describe('redaction on write', () => {
  it('redacts titles and bodies before persisting and tags the note', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: `Deploy key ${FAKE.github}`, body: `Set DEPLOY_TOKEN=${FAKE.openai} in CI` });
    const disk = await readFile(note.path, 'utf8');
    expect(disk).not.toContain(FAKE.github);
    expect(disk).not.toContain(FAKE.openai);
    expect(note.meta.title).toBe('Deploy key [REDACTED:github-token]');
    expect(note.meta.tags).toContain('redacted');
    expect(note.body).toBe('Set DEPLOY_TOKEN=[REDACTED:openai-key] in CI');
  });

  it('redacts update and closeSession bodies', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const hypothesis = await brain.write({ tier: 'transitive', kind: 'hypothesis', title: 'Rate limits', body: 'x' });
    const updated = await brain.update(hypothesis.meta.id, {}, `seen with ${FAKE.anthropic}`);
    expect(updated.body).toBe('seen with [REDACTED:anthropic-key]');
    expect(updated.meta.tags).toContain('redacted');
    const session = await brain.openSession('Debug', 'claude');
    const closed = await brain.closeSession(session.meta.id, `Exported AWS_SECRET_ACCESS_KEY=${rnd}\n${FAKE.pem}`);
    expect(await readFile(closed.path, 'utf8')).not.toMatch(/PRIVATE KEY-----\nMII|Q7xK2mP9/);
    expect(closed.meta.tags).toContain('redacted');
  });

  it('reports redactions from remember', async () => {
    const root = await temp(); const brain = openBrain([{ scope: 'project', root }]);
    const { report } = await brain.remember({ tier: 'transitive', kind: 'lesson', title: 'Slack bot', body: `bot token ${FAKE.slack}` });
    expect(report.redacted).toEqual(['slack-token']);
  });
});
