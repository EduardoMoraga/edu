import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Autonomy, CliId, EngineRunRequest, EduEvent } from '../core/contracts.js';
import { buildAgyArgv, parseLine as parseAgyLine } from './agy.js';
import { AUTONOMY_FLAGS } from './autonomy.js';
import { buildClaudeArgv, parseLine as parseClaudeLine } from './claude.js';
import { buildCodexArgv, parseLine as parseCodexLine } from './codex.js';
import { demoScript, FakeEngine } from './fake.js';
import { buildOpencodeArgv, finalizeOpencode, parseLine as parseOpencodeLine } from './opencode.js';
import { buildPiArgv, parseLine as parsePiLine } from './pi.js';
import { runJsonlProcess } from './process.js';
import type { ParseContext } from './parse.js';

const parsers = {
  claude: parseClaudeLine, codex: parseCodexLine, pi: parsePiLine,
  opencode: parseOpencodeLine, agy: parseAgyLine,
};
const builders = {
  claude: buildClaudeArgv, codex: buildCodexArgv, pi: buildPiArgv,
  opencode: buildOpencodeArgv, agy: buildAgyArgv,
};
const cliIds: CliId[] = ['claude', 'codex', 'pi', 'opencode', 'agy'];
const autonomyLevels: Autonomy[] = ['readonly', 'ask', 'auto', 'full'];
const request = (cli: CliId, autonomy: Autonomy): EngineRunRequest => ({
  cli, prompt: 'inspect this file', cwd: '/workspace', systemPrompt: 'Be careful.', model: 'test-model', autonomy,
});
const context = (): ParseContext => ({ agentId: 'agent-1', at: '2026-01-01T00:00:00.000Z' });

describe('engine argv builders', () => {
  it.each(cliIds.flatMap((cli) => autonomyLevels.map((autonomy) => [cli, autonomy] as const)))('%s maps %s autonomy and request flags', (cli, autonomy) => {
    const built = builders[cli](request(cli, autonomy));
    expect(built.command).toBe(cli);
    expect(built.args).toEqual(expect.arrayContaining([...AUTONOMY_FLAGS[cli][autonomy]]));
    expect(built.args).toContain('test-model');
    if (cli === 'codex' || cli === 'agy') {
      expect(built.args.join(' ')).toContain('Be careful.');
      expect(built.args.join(' ')).toContain('inspect this file');
    }
  });
  it('uses the expected resume/session switch for each adapter', () => {
    const cases: [CliId, string][] = [['claude', '--resume'], ['codex', 'resume'], ['pi', '--session'], ['opencode', '--session'], ['agy', '--conversation']];
    for (const [cli, flag] of cases) {
      const built = builders[cli]({ ...request(cli, 'readonly'), resumeSessionId: 'session-x' });
      expect(built.args).toContain(flag);
      expect(built.args).toContain('session-x');
    }
  });
  it('uses Claude’s documented default permission mode for ask autonomy', () => {
    const built = buildClaudeArgv(request('claude', 'ask'));
    expect(built.args).toContain('--permission-mode');
    expect(built.args).toContain('default');
  });
  it('enables OpenCode thinking output so reasoning parts are emitted', () => {
    expect(buildOpencodeArgv(request('opencode', 'ask')).args).toContain('--thinking');
  });
});

describe('native JSONL fixtures', () => {
  it.each(cliIds)('%s maps fixture lines to normalized events', async (cli) => {
    const path = fileURLToPath(new URL(`./fixtures/${cli}.jsonl`, import.meta.url));
    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    const ctx = context();
    const events = lines.flatMap((line) => parsers[cli](line, ctx));
    if (cli === 'opencode') events.push(...finalizeOpencode(ctx));
    const types = events.map((event) => event.type);
    const expectedTypes: Record<CliId, string[]> = {
      claude: ['agent.thinking', 'agent.text', 'tool.call', 'tool.result', 'usage', 'agent.end'],
      codex: ['agent.thinking', 'agent.text', 'tool.call', 'tool.result', 'usage', 'agent.end'],
      pi: ['agent.thinking', 'agent.text', 'tool.call', 'tool.result', 'usage', 'agent.end'],
      opencode: ['agent.thinking', 'agent.text', 'tool.call', 'tool.result', 'usage', 'agent.end'],
      agy: ['agent.text', 'tool.call', 'tool.result', 'usage', 'agent.end'],
    };
    expect(types).toEqual(expectedTypes[cli]);
    const usage = events.find((event): event is Extract<EduEvent, { type: 'usage' }> => event.type === 'usage');
    expect(usage?.usage.inputTokens).toBe(120);
    expect(usage?.usage.outputTokens).toBe(30);
    if (cli === 'codex' || cli === 'agy') expect(usage?.usage.costUsd).toBeUndefined();
    else expect(usage?.usage.costUsd).toBe(0.0012);
    if (cli === 'codex') {
      expect(usage?.usage.cacheReadTokens).toBe(12);
      expect(usage?.usage.cacheWriteTokens).toBe(8);
    }
    if (cli === 'pi' || cli === 'opencode') {
      expect(usage?.usage.cacheReadTokens).toBe(15);
      expect(usage?.usage.cacheWriteTokens).toBe(4);
    }
    if (cli === 'agy') expect(usage?.usage.cacheReadTokens).toBe(15);
    expect(events.every((event) => !('agentId' in event) || event.agentId === 'agent-1')).toBe(true);
    const end = events.find((event): event is Extract<EduEvent, { type: 'agent.end' }> => event.type === 'agent.end');
    expect(end?.sessionId).toBe(`${cli}-demo-session`);
    expect(end?.ok).toBe(true);
    const calls = events.filter((event): event is Extract<EduEvent, { type: 'tool.call' }> => event.type === 'tool.call');
    const results = events.filter((event): event is Extract<EduEvent, { type: 'tool.result' }> => event.type === 'tool.result');
    expect(calls).toHaveLength(1);
    expect(results).toHaveLength(1);
    expect(results[0]?.callId).toBe(calls[0]?.callId);
  });

  it('marks Pi failed when its final assistant message and retry both fail', () => {
    const ctx: ParseContext = { ...context(), sessionId: 'pi-error-session' };
    const lines = [
      { type: 'message_end', message: { role: 'assistant', stopReason: 'error', content: [{ type: 'text', text: 'Request failed.' }] } },
      { type: 'auto_retry_end', success: false, attempt: 3, finalError: 'provider unavailable' },
      { type: 'agent_end', messages: [], willRetry: false },
      { type: 'agent_settled', aborted: false },
    ];
    const events = lines.flatMap((line) => parsePiLine(JSON.stringify(line), ctx));
    expect(events).toEqual([expect.objectContaining({
      type: 'agent.end', ok: false, summary: 'Request failed.', sessionId: 'pi-error-session',
    })]);
  });

  it('emits one Pi usage event per assistant response, not per delta or only the last turn', () => {
    const ctx: ParseContext = { ...context(), sessionId: 'pi-multi-turn' };
    const lines = [
      { type: 'message_update', usage: { input: 10, output: 2, cacheRead: 4, cacheWrite: 1 }, assistantMessageEvent: { type: 'text_delta', delta: 'First' } },
      { type: 'message_update', usage: { input: 10, output: 2, cacheRead: 4, cacheWrite: 1 }, assistantMessageEvent: { type: 'text_delta', delta: ' response' } },
      { type: 'message_end', message: { role: 'assistant', stopReason: 'end_turn', content: [{ type: 'text', text: 'First response' }] } },
      { type: 'message_update', usage: { input: 20, output: 3, cacheRead: 8, cacheWrite: 2 }, assistantMessageEvent: { type: 'text_delta', delta: 'Second response' } },
      { type: 'message_end', message: { role: 'assistant', stopReason: 'end_turn', content: [{ type: 'text', text: 'Second response' }] } },
      { type: 'agent_settled', aborted: false },
    ];
    const events = lines.flatMap((line) => parsePiLine(JSON.stringify(line), ctx));
    expect(events.map((event) => event.type)).toEqual(['agent.text', 'agent.text', 'usage', 'agent.text', 'usage', 'agent.end']);
    expect(events.filter((event): event is Extract<EduEvent, { type: 'usage' }> => event.type === 'usage').map((event) => event.usage.inputTokens)).toEqual([10, 20]);
  });
});

describe('process and fake engine', () => {
  it('preserves multibyte characters split across stdout chunks', async () => {
    const script = `const b=Buffer.from('{"text":"🌍"}\\n'); process.stdout.write(b.subarray(0,12)); setTimeout(()=>process.stdout.write(b.subarray(12)),10);`;
    const parser = (line: string, ctx: ParseContext): EduEvent[] => {
      const value = JSON.parse(line) as { text: string };
      return [{ type: 'agent.text', agentId: ctx.agentId, text: value.text, at: '2026-01-01T00:00:00.000Z' }];
    };
    const events: EduEvent[] = [];
    for await (const event of runJsonlProcess({ command: process.execPath, args: ['-e', script] }, process.cwd(), 'split-test', parser)) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent.text', text: '🌍' }));
  });

  it('ends OpenCode on successful process idle/exit without requiring a done record', async () => {
    const script = `process.stdout.write('{"type":"text","sessionID":"open-session","part":{"type":"text","text":"Final answer"}}\\n');`;
    const events: EduEvent[] = [];
    for await (const event of runJsonlProcess(
      { command: process.execPath, args: ['-e', script] }, process.cwd(), 'open-test', parseOpencodeLine, undefined,
      (_code, ctx) => finalizeOpencode(ctx),
    )) events.push(event);
    expect(events.map((event) => event.type)).toEqual(['agent.text', 'agent.end']);
    expect(events.at(-1)).toMatchObject({ type: 'agent.end', sessionId: 'open-session', summary: 'Final answer' });
  });

  it('drops oversized lines, emits an error, then continues with the next line', async () => {
    const script = `process.stdout.write('x'.repeat(1024*1024+1)+'\\n{"ok":true}\\n');`;
    const parser = (line: string, ctx: ParseContext): EduEvent[] => [{ type: 'agent.text', agentId: ctx.agentId, text: line, at: '2026-01-01T00:00:00.000Z' }];
    const events: EduEvent[] = [];
    for await (const event of runJsonlProcess({ command: process.execPath, args: ['-e', script] }, process.cwd(), 'cap-test', parser)) events.push(event);
    expect(events[0]).toMatchObject({ type: 'error', message: 'Dropped JSONL line exceeding 1048576 bytes' });
    expect(events[1]).toMatchObject({ type: 'agent.text', text: '{"ok":true}' });
  });

  it('escalates abort to SIGKILL for a resistant process group', async () => {
    const controller = new AbortController();
    const events: EduEvent[] = [];
    let pids: number[] = [];
    const script = `const c=require('node:child_process').spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});process.on('SIGTERM',()=>{});console.log(JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000);`;
    const parser = (line: string, ctx: ParseContext): EduEvent[] => {
      pids = JSON.parse(line) as number[];
      return [{ type: 'agent.text', agentId: ctx.agentId, text: line, at: '2026-01-01T00:00:00.000Z' }];
    };
    const collect = (async () => {
      for await (const event of runJsonlProcess({ command: process.execPath, args: ['-e', script] }, process.cwd(), 'abort-test', parser, controller.signal)) {
        events.push(event);
        if (event.type === 'agent.text') controller.abort();
      }
    })();
    await Promise.race([collect, new Promise((_, reject) => setTimeout(() => reject(new Error('process group did not exit after abort')), 2500))]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', message: 'Process cancelled' }));
    expect(pids).toHaveLength(2);
    for (const pid of pids) expect(() => process.kill(pid!, 0)).toThrow();
  });

  it('still SIGKILLs a resistant descendant after the parent exits on SIGTERM', async () => {
    const controller = new AbortController();
    let pids: number[] = [];
    const script = `const c=require('node:child_process').spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});process.on('SIGTERM',()=>process.exit(0));console.log(JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000);`;
    const parser = (line: string, ctx: ParseContext): EduEvent[] => {
      pids = JSON.parse(line) as number[];
      return [{ type: 'agent.text', agentId: ctx.agentId, text: line, at: '2026-01-01T00:00:00.000Z' }];
    };
    const collect = (async () => {
      for await (const event of runJsonlProcess({ command: process.execPath, args: ['-e', script] }, process.cwd(), 'descendant-test', parser, controller.signal)) {
        if (event.type === 'agent.text') controller.abort();
      }
    })();
    await Promise.race([collect, new Promise((_, reject) => setTimeout(() => reject(new Error('resistant descendant survived')), 2500))]);
    expect(pids).toHaveLength(2);
    for (const pid of pids) {
      let gone = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        try { process.kill(pid!, 0); } catch { gone = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(gone).toBe(true);
    }
  });

  it('cleans up a resistant process group when the async iterator closes early', async () => {
    let pids: number[] = [];
    const script = `const c=require('node:child_process').spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});process.on('SIGTERM',()=>{});console.log(JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000);`;
    const parser = (line: string, ctx: ParseContext): EduEvent[] => {
      pids = JSON.parse(line) as number[];
      return [{ type: 'agent.text', agentId: ctx.agentId, text: line, at: '2026-01-01T00:00:00.000Z' }];
    };
    const iterator = runJsonlProcess({ command: process.execPath, args: ['-e', script] }, process.cwd(), 'return-test', parser)[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.type).toBe('agent.text');
    await iterator.return?.();
    expect(pids).toHaveLength(2);
    for (const pid of pids) expect(() => process.kill(pid!, 0)).toThrow();
  });

  it('replays the fake scenario in script order', async () => {
    const script = demoScript();
    const engine = new FakeEngine(script);
    const events: EduEvent[] = [];
    for await (const event of engine.run(request('claude', 'readonly'), 'ignored')) events.push(event);
    expect(events).toEqual(script);
    expect(events[0]?.type).toBe('run.start');
    expect(events.at(-1)?.type).toBe('run.end');
    expect(events.findIndex((event) => event.type === 'tool.call')).toBeLessThan(events.findIndex((event) => event.type === 'tool.result'));
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent.end', agentId: 'lead-1', ok: true }));
  });
});
