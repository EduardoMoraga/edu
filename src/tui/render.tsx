/**
 * Entry point used by `src/cli/`: mounts the live view on the terminal.
 * Ctrl+C is handled by the App (first press cancels the run, second quits).
 */
import { render, type Instance } from 'ink';
import { detectTheme, getGlyphs } from '../identity/index.js';
import { App, type AppProps } from './App.js';

export interface RenderTuiOptions {
  stdout?: NodeJS.WriteStream;
  stdin?: NodeJS.ReadStream;
  stderr?: NodeJS.WriteStream;
  env?: Readonly<Record<string, string | undefined>>;
  /** Route console.* above the UI (Ink default). Disable under test runners. */
  patchConsole?: boolean;
}

export function renderTui(props: AppProps, opts: RenderTuiOptions = {}): Instance {
  const stdout = opts.stdout ?? process.stdout;
  const env = opts.env ?? process.env;
  const theme = props.theme ?? detectTheme(env, Boolean(stdout.isTTY));
  const glyphs = props.glyphs ?? getGlyphs(env);
  return render(<App {...props} theme={theme} glyphs={glyphs} />, {
    stdout,
    stdin: opts.stdin ?? process.stdin,
    stderr: opts.stderr ?? process.stderr,
    exitOnCtrlC: false,
    patchConsole: opts.patchConsole ?? true,
  });
}
