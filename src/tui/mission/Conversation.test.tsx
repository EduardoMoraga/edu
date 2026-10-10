import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { createChannel } from '../../cli/run/channel.js';
import type { EduEvent } from '../../core/contracts.js';
import { ASCII_GLYPHS, UNICODE_GLYPHS, createTheme, displayWidth } from '../../identity/index.js';
import { App, type AppProps } from '../App.js';
import { chatEvents, fixtureAt } from '../fixtures.js';

const plain = createTheme(0);
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const noop = () => {};

let instance: ReturnType<typeof render> | undefined;
afterEach(() => {
  instance?.unmount();
  instance = undefined;
});

const mount = (props: Partial<AppProps> & { columns: number; rows: number }) =>
  render(<App events={chatEvents()} theme={plain} glyphs={UNICODE_GLYPHS} onSubmit={noop} {...props} />);
const frame = () => instance!.lastFrame()!;
const count = (text: string, needle: string) => text.split(needle).length - 1;

/** A crew run starting after the chat, as live.ts streams `/run`. */
function crewStart(): EduEvent[] {
  return [
    { type: 'chat.user', text: '/run add a README', at: fixtureAt(10) },
    { type: 'agent.text', agentId: 'edu', text: 'Edu will run this as a task: add a README', at: fixtureAt(10) },
    { type: 'run.start', runId: 'r1', goal: 'add a README', mode: 'solo', at: fixtureAt(11) },
    { type: 'agent.spawn', agentId: 'r1-lead', role: 'lead', cli: 'claude', task: 'Write the spec', at: fixtureAt(11) },
    { type: 'agent.status', agentId: 'r1-lead', status: 'running', at: fixtureAt(11) },
  ];
}

describe('conversation view', () => {
  it('renders the transcript as the main area with both turns and the recalled ids', () => {
    instance = mount({ columns: 160, rows: 40 });
    const f = frame();
    const lines = f.split('\n');
    expect(lines).toHaveLength(40);
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(160);
    expect(f).toContain('─ conversation ─');
    expect(f).not.toContain('constellation');
    expect(f).toMatch(/› you {2}Hola {2}\d\d:\d\d/);
    expect(f).toMatch(/◆ edu {2}\d\d:\d\d/);
    expect(f).toContain('¡Hola! Tienes un compromiso abierto');
    expect(f).toContain('↺ C-entregar-informe-semanal-cheil · D-usar-bun');
    expect(lines.at(-1)).toMatch(/^ ◆ chat\s+pgup\/pgdn chat · tab view · \/ commands/);
  });
  it('shows the answer once: no duplicate summary in the bus or the deck', () => {
    instance = mount({ columns: 160, rows: 40 });
    const f = frame();
    expect(count(f, '¡Hola!')).toBe(2); // transcript + the bus message line
    expect(f).not.toMatch(/done · ¡Hola!/);
    expect(f).toMatch(/● you\s+→ edu\s+Hola/);
    expect(f).not.toMatch(/● edu\s+→ edu/);
    expect(f).toMatch(/● edu\s+→ you\s+done/);
  });
  it('keeps the deck compact: run · brain · context, no empty gate, agents or log', () => {
    instance = mount({ columns: 160, rows: 40 });
    const f = frame();
    for (const section of ['run', 'brain', 'context']) expect(f).toContain(`╭─ ${section} ─`);
    for (const section of ['gate', 'agents', 'log']) expect(f).not.toContain(`╭─ ${section} `);
    expect(f).toMatch(/─ brain ─+ ↺2 \+0 ─╮/);
  });
  it('starts the home view on an empty conversation with a hint', () => {
    instance = mount({ columns: 160, rows: 40, events: [] });
    expect(frame()).toContain('─ conversation ─');
    expect(frame()).toContain('say hi, ask what Edu remembers');
  });
  it('cuts recalled ids only when the line would overflow', () => {
    const ids = ['C-entregar-informe-semanal-cheil', 'D-usar-bun-para-scripts-internos', 'L-revisar-antes-de-entregar', 'H-cliente-prefiere-pdf'];
    const events = chatEvents().map((e) => (e.type === 'brain.recall' ? { ...e, noteIds: ids } : e));
    instance = mount({ columns: 100, rows: 30, events });
    expect(frame()).toMatch(/↺ C-entregar-informe-se… · D-usar-bun-para-scrip… · L-revisar/);
    expect(frame()).not.toContain('gate ✓0');
  });
  it('shows a waiting row while Edu thinks', () => {
    instance = mount({ columns: 120, rows: 30, events: chatEvents().slice(0, 4) });
    expect(frame()).toMatch(/◆ edu {2}…/);
  });
  it('is pure ASCII with ASCII glyphs', () => {
    instance = render(<App events={chatEvents().map((e) => (e.type === 'agent.text' || e.type === 'agent.end' ? { ...e, ...(e.type === 'agent.text' ? { text: 'Hello there' } : { summary: 'Hello there' }) } : e))} theme={plain} glyphs={ASCII_GLYPHS} onSubmit={noop} columns={160} rows={40} />);
    const f = frame();
    expect(f).toContain('> you  Hola');
    expect(f).toContain('* edu');
    // `$—` (unknown cost) comes from identity's formatCost, which has no ASCII fallback yet.
    expect([...f.replaceAll('$—', '$-')].filter((ch) => ch.charCodeAt(0) >= 128).join('')).toBe('');
  });
  it('scrolls the transcript with page keys', async () => {
    const many: EduEvent[] = [];
    for (let i = 0; i < 30; i++) {
      many.push({ type: 'chat.user', text: `question ${i}`, at: fixtureAt(i * 2) });
      many.push({ type: 'agent.text', agentId: 'edu', text: `answer ${i}`, at: fixtureAt(i * 2 + 1) });
      many.push({ type: 'agent.end', agentId: 'edu', ok: true, summary: `answer ${i}`, at: fixtureAt(i * 2 + 1) });
    }
    instance = mount({ columns: 160, rows: 40, events: many });
    expect(frame()).toContain('answer 29');
    await tick();
    instance.stdin.write('\u001B[5~');
    await tick();
    expect(frame()).toMatch(/─ conversation ─+ \d+ newer ↓ end ─╮/);
    expect(frame()).not.toContain('› you  question 29');
  });
});

describe('conversation ⇄ constellation', () => {
  it('switches to the constellation when a crew agent spawns, and tab toggles back and forth', async () => {
    const channel = createChannel<EduEvent>();
    instance = render(<App events={channel} theme={plain} glyphs={UNICODE_GLYPHS} onSubmit={noop} columns={160} rows={40} />);
    for (const e of chatEvents()) channel.push(e);
    await tick();
    expect(frame()).toContain('─ conversation ─');
    for (const e of crewStart()) channel.push(e);
    await tick();
    expect(frame()).toContain('─ constellation ─');
    expect(frame()).toContain('╭─ agents ─');
    instance.stdin.write('\t');
    await tick();
    expect(frame()).toContain('─ conversation ─');
    expect(frame()).toContain('Edu will run this as a task: add a README');
    instance.stdin.write('\t');
    await tick();
    expect(frame()).toContain('─ constellation ─');
    channel.close();
  });
  it('/view toggles too, and is unavailable without a conversation', async () => {
    instance = mount({ columns: 160, rows: 40, events: [...chatEvents(), ...crewStart()] });
    await tick();
    for (const ch of '/view') {
      instance.stdin.write(ch);
      await tick(4);
    }
    instance.stdin.write('\r');
    await tick();
    expect(frame()).toContain('─ conversation ─');
    instance.unmount();
    instance = mount({ columns: 160, rows: 40, events: crewStart().slice(2) });
    await tick();
    for (const ch of '/view') {
      instance.stdin.write(ch);
      await tick(4);
    }
    instance.stdin.write('\r');
    await tick();
    expect(frame()).toContain('/view is not available in this view');
  });
});

describe('inline markdown in answers', () => {
  it('renders bold, code and note ids without raw markers', async () => {
    const { inlineMarkdown } = await import('./transcript.js');
    const segments = inlineMarkdown('Hay **5 decisiones** en banda `verified`: [[D-uno]].');
    expect(segments.map((s) => s.text).join('')).toBe('Hay 5 decisiones en banda verified: D-uno.');
    expect(segments.find((s) => s.text === '5 decisiones')?.bold).toBe(true);
    expect(segments.find((s) => s.text === 'verified')?.tone).toBe('accent');
  });
});
