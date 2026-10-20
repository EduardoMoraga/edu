import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { instructionActions, skillActions } from './common.js';
import { materialize } from './operations.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { openBrain } from '../brain/index.js';
import { brief } from '../context/brief.js';

const options = { home: '/fixture/home', templatesDir: resolve('templates') };

describe('installed protocol artifacts', () => {
  it.each(['project', 'global'] as const)('materializes a session-safe %s instruction block without replacing user content', scope => {
    const actions = instructionActions('pi', scope, '/fixture/project', options);
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      const installed = materialize(action, Buffer.from('# User instructions\nNever remove this.\n')).toString();
      expect(installed).toContain('Never remove this.');
      expect(installed).toContain(scope === 'project' ? '@.edu/EDU.md' : `@${join(options.home, '.edu/EDU.md')}`);
      // These assertions inspect the generated public instructions, not implementation source.
      expect(installed).toContain('Reuse an injected Edu brief');
      expect(installed).toContain('Retain an injected Edu session id; only if absent');
      expect(installed).toContain('exact id');
      expect(installed).toContain('edu_capabilities');
      expect(installed).toContain('advisory, never proof');
      expect(installed).toContain('mcp__edu__edu_*');
      expect(materialize(action, Buffer.from(installed)).toString()).toBe(installed);
    }
  });
  it('retains minimal session/recall/capabilities instructions in the real 160-token identity allocation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-protocol-cap-'));
    try {
      const location = { scope: 'project' as const, root };
      const brain = openBrain([location]);
      await brain.init(location);
      const eduMdPath = join(root, 'EDU.md');
      await writeFile(eduMdPath, (await readFile(join(options.templatesDir, 'EDU.md'), 'utf8')).replaceAll('{{name}}', 'Fixture'));
      await writeFile(join(root, 'config.json'), JSON.stringify({ identity: { name: 'Fixture' } }));
      const text = await brief(brain, 1500, { eduMdPath, trackUsage: false });
      for (const required of ['Reuse injected brief', 'edu_session_open(title, source)', 'edu_session_close(id, summary)', 'exact ID per workspace', 'edu_recall', 'edu_read', 'edu_capabilities']) {
        expect(text).toContain(required);
      }
      expect(text).not.toContain('## Host protocol');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('installs skills retaining the session id and distinguishing advisory feedback from evidence', async () => {
    const actions = await skillActions('pi', 'project', '/fixture/project', options);
    const installed = new Map(actions.map(action => [action.path, materialize(action, undefined).toString()]));
    const skill = (name: string) => [...installed].find(([path]) => path.endsWith(join(name, 'SKILL.md')))?.[1];
    expect(skill('edu-brain')).toContain('exact returned id per workspace');
    expect(skill('edu-brain')).toContain('advisory opinion');
    for (const required of ['lessons?: [{title, body, evidence?: [ids]}]', 'max 3', 'candidate/inferred', 'omit if none', 'no second reflection LLM']) {
      expect(skill('edu-brain')).toContain(required);
    }
    expect(skill('edu-review')).toContain('substantial changes');
    expect(skill('edu-crew')).toContain('Do not auto-spawn for trivial tasks');
    expect(skill('edu-brief')).toContain('Reuse an injected brief');
    expect(skill('edu-brief')).toContain('edu_session_open(title, source)');
    expect(skill('edu-recall')).toContain('do not label a lesson proven');
    expect(skill('edu-reflect')).toContain('opinion is not externally verified');
  });
});
