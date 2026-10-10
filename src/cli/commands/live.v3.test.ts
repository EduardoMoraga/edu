import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CliId, EduEvent, Engine } from '../../core/contracts.js';
import { captureContext, out, runCli } from '../testkit.js';

const at = '2026-01-01T00:00:00.000Z';
const plan = {
  requirements: [{ id: 'R-1', text: 'The run completes' }],
  checks: [{ id: 'pass', requirementIds: ['R-1'], command: 'node -e "process.exit(0)"', expect: { exitCode: 0 }, timeoutMs: 1000 }],
  steps: [{ id: 'build', role: 'builder', task: 'Complete the work', dependsOn: [], parallelSafe: false }],
};

function engine(): Engine {
  return {
    cli: 'claude', available: async () => true,
    async *run(request, agentId) {
      const text = request.prompt.includes('Create a safe') ? JSON.stringify(plan)
        : request.prompt.includes('Review the completed') ? '{"verdict":"pass","issues":[]}' : 'Completed.';
      yield { type: 'agent.text', agentId, text, at } satisfies EduEvent;
      yield { type: 'agent.end', agentId, ok: true, summary: text, at } satisfies EduEvent;
    },
  };
}

describe('edu run v0.3', () => {
  it('passes --playbook and --yes through the CLI and verifies the spec', async () => {
    const captured = await captureContext({ detected: ['claude'] });
    captured.ctx.engineFactory = (_cli: CliId) => engine();
    captured.ctx.availableClis = ['claude'];
    await mkdir(join(captured.dirs.eduHome, 'playbooks'), { recursive: true });
    await writeFile(join(captured.dirs.eduHome, 'playbooks', 'custom.md'), '---\nname: custom\ndescription: Custom test method\nharness: H3\nrequireSpecApproval: true\nmaxFixRounds: 1\n---\n\nVerify every requirement.\n');
    await runCli(captured, ['run', 'Complete task', '--playbook', 'custom', '--yes']);
    expect(captured.exitCode).toBeUndefined();
    expect(out(captured)).toContain('autonomous_verified_success');
    expect(out(captured)).toContain('approved (policy)');
    const { readdir } = await import('node:fs/promises');
    const specs = await readdir(join(captured.dirs.eduHome, 'specs'));
    expect(specs).toHaveLength(1);
    const spec = await readFile(join(captured.dirs.eduHome, 'specs', specs[0]!), 'utf8');
    expect(spec).toContain('R-1');
    expect(spec).toContain('Playbook: custom');
  });

  it('prints the spec and rejects it through a plain interactive prompt', async () => {
    const captured = await captureContext({ detected: ['claude'] });
    captured.ctx.engineFactory = () => engine();
    captured.ctx.availableClis = ['claude'];
    captured.ctx.stdinIsTTY = true;
    let question = '';
    captured.ctx.confirm = async value => { question = value; return false; };
    await runCli(captured, ['run', 'Complete task']);
    expect(captured.exitCode).toBe(1);
    expect(out(captured)).toContain('R-1');
    expect(out(captured)).toContain('node -e');
    expect(question).toContain('Approve spec');
  });
});
