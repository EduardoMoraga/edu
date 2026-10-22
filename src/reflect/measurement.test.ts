import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openBrain } from '../brain/index.js';
import type { Engine } from '../core/contracts.js';
import { usageValue } from '../core/usage.js';
import { reflect } from './reflect.js';

it('persists actual reflection attempts and reuses cached measurements without billing a new call', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edu-reflection-measurement-'));
  const root = join(dir, '.edu');
  const brain = openBrain([{ scope: 'project', root }]);
  let calls = 0;
  const engine: Engine = { cli: 'pi', available: async () => true, async *run(_req, agentId) {
    calls++;
    yield { type: 'usage', agentId, at: new Date().toISOString(), usage: { inputTokens: 10, outputTokens: 0, costUsd: 0, known: { inputTokens: true, outputTokens: true, costUsd: true } } };
    yield { type: 'agent.text', agentId, at: new Date().toISOString(), text: JSON.stringify({ lessons: [], hypotheses: [], feedback: [], skillProposals: [], canonicalProposals: [] }) };
  } };
  try {
    await brain.init({ scope: 'project', root });
    const episode = await brain.openSession('Fixture', 'test'); await brain.closeSession(episode.meta.id, 'done');
    const first = await reflect({ brain, brainRoot: root, engine });
    const cached = await reflect({ brain, brainRoot: root, engine });
    expect(calls).toBe(1);
    expect(cached.usage).toEqual(first.usage);
    expect(usageValue(cached.usage!, 'inputTokens')).toBe(10);
    expect(usageValue(cached.usage!, 'costUsd')).toBe(0);
    expect(cached.usage!.observationIds).toHaveLength(3);
    await appendFile(cached.measurementPath!, '{"invocationId":"torn');
    const recovered = await reflect({ brain, brainRoot: root, engine });
    expect(calls).toBe(1);
    expect(recovered.usage!.inputTokens).toBe(10);
    expect(usageValue(recovered.usage!, 'inputTokens')).toBeNull();
    expect(usageValue(recovered.usage!, 'costUsd')).toBeNull();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
