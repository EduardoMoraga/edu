/**
 * v0.2 usability: wrapping instead of truncation, scrollable focus pane with
 * follow mode, multi-line composer, `/` command palette and Spanish labels.
 */
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannel } from '../cli/run/channel.js';
import type { EduEvent } from '../core/contracts.js';
import { UNICODE_GLYPHS, createTheme } from '../identity/index.js';
import { App, type AppProps } from './App.js';
import { fixtureAt, oauthRun } from './fixtures.js';

const plain = createTheme(0);
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const mount = (props: Partial<AppProps> = {}) =>
  render(<App events={oauthRun()} theme={plain} glyphs={UNICODE_GLYPHS} columns={100} rows={30} {...props} />);

let instance: ReturnType<typeof render> | undefined;
afterEach(() => {
  instance?.unmount();
  instance = undefined;
});

const frame = () => instance!.lastFrame()!;
/** Frame text without the box drawing, so wrapped words can be searched. */
const flat = () => frame().replace(/[│╭╮╰╯─┌┐└┘├┤┬┴┼]/g, ' ').replace(/\s+/g, ' ');
async function type(text: string) {
  for (const ch of text) {
    instance!.stdin.write(ch);
    await tick(4);
  }
  await tick();
}
async function press(seq: string) {
  instance!.stdin.write(seq);
  await tick();
}

const KEYS = { up: '\u001B[A', down: '\u001B[B', left: '\u001B[D', right: '\u001B[C', home: '\u001B[H', end: '\u001B[F', pgUp: '\u001B[5~', esc: '\u001B', tab: '\t', enter: '\r', altEnter: '\u001B\r' };

const LONG = 'alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu';

function single(extra: EduEvent[] = [], goal = 'goal'): EduEvent[] {
  return [
    { type: 'run.start', runId: 'r', goal, mode: 'solo', at: fixtureAt(0) },
    { type: 'agent.spawn', agentId: 'b', role: 'builder', cli: 'codex', task: 'build it', at: fixtureAt(1) },
    { type: 'agent.status', agentId: 'b', status: 'running', at: fixtureAt(1) },
    ...extra,
  ];
}

describe('wrapping instead of truncation', () => {
  it('wraps long agent text and errors in the focus pane without an ellipsis', () => {
    instance = mount({
      events: single([
        { type: 'agent.text', agentId: 'b', text: LONG, at: fixtureAt(2) },
        { type: 'error', agentId: 'b', message: `boom ${LONG}`, at: fixtureAt(3) },
      ]),
    });
    expect(frame()).not.toContain('…');
    expect(flat()).toContain(LONG);
    expect(flat()).toContain(`boom ${LONG}`);
  });

  it('wraps a long goal in the header instead of cutting it', () => {
    instance = mount({ events: single([], `refactor ${LONG}`) });
    expect(flat()).toContain(`"refactor ${LONG}"`);
    for (const line of frame().split('\n')) expect([...line].length).toBeLessThanOrEqual(100);
  });

  it('wraps a long approval title', () => {
    instance = mount({
      events: single([{ type: 'approval.request', agentId: 'b', approvalId: 'a1', title: `write ${LONG}`, detail: 'd', at: fixtureAt(2) }]),
    });
    expect(flat()).toContain(`write ${LONG}`);
  });
});

describe('focus pane scrolling', () => {
  const many = (from: number, n: number): EduEvent[] =>
    Array.from({ length: n }, (_, i) => ({ type: 'agent.text', agentId: 'b', text: `line-${from + i}\n`, at: fixtureAt(2) }) as EduEvent);

  it('follows new output by default and holds position after scrolling up', async () => {
    const channel = createChannel<EduEvent>();
    for (const e of single(many(1, 40))) channel.push(e);
    instance = mount({ events: channel });
    await tick(40);
    expect(frame()).toContain('line-40');

    await press(KEYS.tab); // agents → focus
    await press(KEYS.pgUp);
    expect(frame()).not.toContain('line-40');
    const pinned = frame().match(/line-\d+/g)!;

    for (const e of many(41, 5)) channel.push(e);
    await tick(40);
    expect(frame().match(/line-\d+/g)).toEqual(pinned);
    expect(frame()).toMatch(/\d+ newer lines below/);

    await press(KEYS.end);
    expect(frame()).toContain('line-45');
    expect(frame()).not.toMatch(/newer lines below/);
    channel.close();
  });

  it('scrolls line by line with arrows in the focus pane', async () => {
    instance = mount({ events: single(many(1, 40)) });
    await tick();
    await press(KEYS.tab);
    await press(KEYS.up);
    expect(frame()).not.toContain('line-40');
    expect(frame()).toContain('line-39');
    await press(KEYS.down);
    expect(frame()).toContain('line-40');
  });
});

describe('multi-line composer', () => {
  it('edits with cursor keys, inserts newlines with alt+enter and submits the whole text', async () => {
    const onSubmit = vi.fn();
    instance = mount({ events: [], onSubmit });
    await tick();
    await type('ab');
    await press(KEYS.altEnter);
    await type('cd');
    await press(KEYS.left);
    await type('X');
    expect(frame()).toContain('› ab');
    expect(frame()).toContain('cX▏d');
    await press(KEYS.home);
    await type('>');
    expect(frame()).toContain('>▏cXd');
    await press(KEYS.enter);
    expect(onSubmit).toHaveBeenCalledWith('ab\n>cXd');
  });

  it('accepts pasted chunks (plain and bracketed) and clears with esc', async () => {
    const onSubmit = vi.fn();
    instance = mount({ events: [], onSubmit });
    await tick();
    await press('pasted words here');
    expect(frame()).toContain('pasted words here');
    await press('\u001B[200~one\ntwo\u001B[201~');
    expect(frame()).toContain('hereone');
    expect(frame()).toContain('two');
    await press(KEYS.esc);
    expect(frame()).not.toContain('pasted');
    expect(frame()).toContain('type what you want Edu to do');
  });

  it('grows up to five rows and then scrolls', async () => {
    instance = mount({ events: [], onSubmit: () => {} });
    await tick();
    for (let i = 1; i <= 7; i++) {
      await type(`row${i}`);
      if (i < 7) await press(KEYS.altEnter);
    }
    expect(frame()).toContain('row7');
    expect(frame()).toContain('row3');
    expect(frame()).not.toContain('row2');
  });
});

describe('command palette and help', () => {
  it('opens on / in an empty composer, filters, and runs the selection', async () => {
    const onApprove = vi.fn();
    instance = mount({ onApprove, onSubmit: () => {} });
    await tick();
    await type('/');
    expect(frame()).toContain('COMMANDS');
    expect(frame()).toContain('/help');
    expect(frame()).toContain('/quit');
    await type('appr');
    expect(frame()).toContain('/approve');
    expect(frame()).not.toContain('/help');
    await press(KEYS.enter);
    expect(onApprove).toHaveBeenCalledWith('ap-1', true);
    expect(frame()).not.toContain('COMMANDS');
  });

  it('moves the selection with arrows and completes commands that take arguments', async () => {
    const onCommand = vi.fn(() => 'found 2 notes');
    instance = mount({ events: [], onSubmit: () => {}, onCommand });
    await tick();
    await type('/re');
    await press(KEYS.down); // reject → recall
    await press(KEYS.enter);
    expect(frame()).toContain('/recall ');
    await type('oauth');
    await press(KEYS.enter);
    expect(onCommand).toHaveBeenCalledWith('recall', 'oauth');
    await tick();
    expect(frame()).toContain('found 2 notes');
  });

  it('switches the interface to Spanish with /lang es', async () => {
    instance = mount({ events: [], onSubmit: () => {} });
    await tick();
    await type('/lang es');
    await press(KEYS.enter);
    expect(frame()).toContain('AGENTES');
  });

  it('offers crew actions only in watch mode', async () => {
    instance = mount({ events: [], onSubmit: () => {}, crew: true });
    await tick();
    await type('/');
    expect(frame()).toContain('/dispatch');
    expect(frame()).toContain('/status');
  });

  it('opens the palette from the agents pane too, and ? shows help from an empty composer', async () => {
    instance = mount();
    await tick();
    await type('/');
    expect(frame()).toContain('COMMANDS');
    await press(KEYS.esc);
    expect(frame()).not.toContain('COMMANDS');
    instance.unmount();
    instance = mount({ events: [], onSubmit: () => {} });
    await tick();
    await type('?');
    expect(frame()).toContain('KEYS');
    expect(frame()).toContain('alt+enter');
  });
});

describe('Spanish locale', () => {
  it('renders TUI labels, placeholders and help in Spanish', async () => {
    instance = mount({ events: [], onSubmit: () => {}, lang: 'es' });
    await tick();
    expect(frame()).toContain('esperando una ejecución');
    expect(frame()).toContain('AGENTES');
    expect(frame()).toContain('aún no hay agentes');
    expect(frame()).toContain('escribe lo que quieres que Edu haga');
    await type('?');
    expect(frame()).toContain('TECLAS');
    expect(frame()).toContain('nueva línea en el mensaje');
  });

  it('translates status and approval labels', () => {
    instance = mount({ lang: 'es' });
    expect(frame()).toContain('esperando aprobación');
    expect(frame()).toContain('APROBACIÓN');
    expect(frame()).toContain('[y] aprobar');
  });
});
