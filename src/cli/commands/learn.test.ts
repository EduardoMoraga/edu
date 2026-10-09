import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openBrain } from '../../brain/index.js';
import { captureContext, runCli } from '../testkit.js';

describe('edu context', () => {
  it('previews context without recording usage', async () => {
    const c = await captureContext();
    await runCli(c, ['init']);
    const root = join(c.dirs.cwd, '.edu');
    const brain = openBrain([{ scope: 'project', root }]);
    const note = await brain.write({ tier: 'transitive', kind: 'lesson', title: 'Preview usage lesson', body: 'read-only context preview' });
    await runCli(c, ['context', '--query', 'preview usage']);
    expect((await brain.read(note.meta.id))?.meta.usage).toBeUndefined();
  });
});

describe('edu reflect', () => {
  it('succeeds with a clear message when the brain has no closed episodes and no CLI', async () => {
    const c = await captureContext({ detected: [] });
    await runCli(c, ['init']);
    await runCli(c, ['reflect']);
    expect(c.exitCode).toBeUndefined();
    expect(c.stdout.join('\n')).toContain('Nothing to reflect yet.');
  });
});
