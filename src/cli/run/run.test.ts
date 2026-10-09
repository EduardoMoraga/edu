import { describe, expect, it } from 'vitest';
import type { EduEvent } from '../../core/contracts.js';
import { demoScript } from '../../engine/fake.js';
import { ASCII_GLYPHS, UNICODE_GLYPHS } from '../../identity/index.js';
import { captureContext, out, runCli } from '../testkit.js';
import { ApprovalBridge } from './bridge.js';
import { createChannel } from './channel.js';
import { createPlainFormatter } from './plain.js';

const at = '2026-10-08T12:00:00.000Z';
const request = { agentId: 'b', stepId: 's1', title: 't', detail: 'd' };

describe('ApprovalBridge', () => {
  it('resolves the pending approval with the TUI answer', async () => {
    const bridge = new ApprovalBridge();
    bridge.observe({ type: 'approval.request', agentId: 'b', approvalId: 'a1', title: 't', detail: 'd', at });
    const pending = bridge.approve(request);
    bridge.answer('a1', true);
    await expect(pending).resolves.toBe(true);
  });

  it('keeps an answer that arrives before approve() is called', async () => {
    const bridge = new ApprovalBridge();
    bridge.observe({ type: 'approval.request', agentId: 'b', approvalId: 'a2', title: 't', detail: 'd', at });
    bridge.answer('a2', false);
    await expect(bridge.approve(request)).resolves.toBe(false);
  });

  it('rejects everything outstanding on cancel', async () => {
    const bridge = new ApprovalBridge();
    bridge.observe({ type: 'approval.request', agentId: 'b', approvalId: 'a3', title: 't', detail: 'd', at });
    const pending = bridge.approve(request);
    bridge.rejectAll();
    await expect(pending).resolves.toBe(false);
  });
});

describe('createChannel', () => {
  it('delivers buffered and later values, then ends on close', async () => {
    const channel = createChannel<number>();
    channel.push(1);
    const seen: number[] = [];
    const done = (async () => {
      for await (const v of channel) seen.push(v);
    })();
    channel.push(2);
    await new Promise((r) => setTimeout(r, 0));
    channel.close();
    channel.push(3);
    await done;
    expect(seen).toEqual([1, 2]);
  });
});

describe('plain formatter', () => {
  it('renders one readable line per meaningful event', () => {
    const lines = demoScript().map(createPlainFormatter(UNICODE_GLYPHS)).filter(Boolean);
    expect(lines[0]).toBe('◆ run demo-001 · crew · Prepare a small, reviewed feature');
    expect(lines).toContain('⚙ builder › read_file {"path":"src/example.ts"}');
    expect(lines).toContain('⏸ approved (user)');
    expect(lines.at(-1)).toBe('✓ run finished: Demo crew completed successfully.');
  });

  it('stays 7-bit with ASCII glyphs and skips usage/thinking', () => {
    const format = createPlainFormatter(ASCII_GLYPHS);
    const lines = demoScript().map(format).filter((l): l is string => Boolean(l));
    expect(lines.every((l) => /^[\x20-\x7e]*$/.test(l))).toBe(true);
    const usage: EduEvent = { type: 'usage', agentId: 'x', usage: { inputTokens: 1, outputTokens: 1 }, at };
    expect(format(usage)).toBeUndefined();
  });
});

describe('edu demo', () => {
  it('falls back to plain lines when stdout is not a terminal', async () => {
    const c = await captureContext({ isTTY: false, detected: [] });
    await runCli(c, ['demo']);
    expect(c.exitCode).toBeUndefined();
    const text = out(c);
    expect(text).toContain('non-interactive');
    expect(text).toContain('learned lesson: Validate empty input at the boundary');
    expect(text).toContain('run finished');
  });
});

describe('edu ui --replay', () => {
  it('replays a recorded run as plain lines and reports bad lines', async () => {
    const c = await captureContext({ isTTY: false });
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const file = join(c.dirs.cwd, 'run.jsonl');
    await writeFile(file, `${demoScript().map((e) => JSON.stringify(e)).join('\n')}\nnot json\n`);
    await runCli(c, ['ui', '--replay', file, '--speed', '4']);
    expect(out(c)).toContain('run finished');
    expect(c.stderr.join('\n')).toMatch(/run\.jsonl:\d+: invalid JSON/);
  });
});

describe('core event filter', () => {
  it('drops non-core records from recorded runs', async () => {
    const { coreEvents, isCoreEvent } = await import('./events.js');
    const mixed = [{ type: 'outcome', at }, ...demoScript().slice(0, 2)];
    expect(mixed.filter(isCoreEvent)).toHaveLength(2);
    async function* source() { yield* mixed; }
    const seen: string[] = [];
    for await (const e of coreEvents(source())) seen.push(e.type);
    expect(seen).toEqual(['run.start', 'agent.spawn']);
  });
});
