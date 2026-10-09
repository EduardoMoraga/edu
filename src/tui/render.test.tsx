import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { oauthRun } from './fixtures.js';
import { renderTui } from './render.js';

class FakeStdout extends EventEmitter {
  columns = 100;
  rows = 30;
  isTTY = false;
  output = '';
  write = (chunk: string) => {
    this.output += chunk;
    return true;
  };
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  setRawMode() {}
  setEncoding() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
  read() {
    return null;
  }
}

describe('renderTui', () => {
  it('mounts with environment-derived theme and glyphs', () => {
    const stdout = new FakeStdout();
    const app = renderTui(
      { events: oauthRun() },
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stderr: new FakeStdout() as unknown as NodeJS.WriteStream,
        stdin: new FakeStdin() as unknown as NodeJS.ReadStream,
        env: { NO_COLOR: '1', EDU_ASCII: '1' },
        patchConsole: false,
      },
    );
    app.unmount();
    expect(stdout.output).toContain('* EDU');
    expect(stdout.output).not.toMatch(/\u001B\[[0-9;]*m/);
  });
});
