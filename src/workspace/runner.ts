/**
 * The headless LLM runner for `edu create`, built on the same engines the crew uses (claude -p,
 * codex exec, pi, opencode run): the prompt travels on stdin, stdout is normalized JSONL, and the
 * run happens in an empty temporary directory with read-only autonomy so the CLI has nothing to
 * touch. Tests inject their own runner instead.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliId, Engine } from '../core/contracts.js';
import type { LlmRunner } from './extract.js';

/** CLIs that can extract, in preference order (agy has no stable headless JSON mode). */
export const EXTRACTION_CLIS: CliId[] = ['claude', 'codex', 'pi', 'opencode'];

export const EXTRACTION_TIMEOUT_MS = 10 * 60 * 1000;

export function pickExtractionCli(detected: CliId[], requested?: CliId): CliId | undefined {
  if (requested) {
    if (!EXTRACTION_CLIS.includes(requested)) throw new Error(`--cli ${requested} cannot extract knowledge; use ${EXTRACTION_CLIS.join(', ')}`);
    return requested;
  }
  return EXTRACTION_CLIS.find(cli => detected.includes(cli));
}

export function cliRunner(cli: CliId, engineFactory?: (cli: CliId) => Engine, timeoutMs = EXTRACTION_TIMEOUT_MS): LlmRunner {
  return async (prompt) => {
    const engine = engineFactory ? engineFactory(cli) : (await import('../engine/index.js')).createEngine(cli);
    const cwd = await mkdtemp(join(tmpdir(), 'edu-create-'));
    const signal = AbortSignal.timeout(timeoutMs);
    let text = '';
    let final = '';
    try {
      for await (const event of engine.run({ cli, prompt, cwd, autonomy: 'readonly', signal }, 'edu-create')) {
        if (event.type === 'agent.text') text += event.text;
        else if (event.type === 'agent.end' || event.type === 'run.end') {
          if (!event.ok) throw new Error(`${cli} ended with an error${event.summary ? `: ${event.summary.slice(0, 300)}` : ''}`);
          final = event.summary || final;
        } else if (event.type === 'error') throw new Error(`${cli}: ${event.message}`);
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
    const answer = final.trim() || text.trim();
    if (!answer) throw new Error(`${cli} returned no answer`);
    return answer;
  };
}
