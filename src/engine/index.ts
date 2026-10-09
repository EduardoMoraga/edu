import type { CliId, Engine } from '../core/contracts.js';
import { agyEngine } from './agy.js';
import { claudeEngine } from './claude.js';
import { codexEngine } from './codex.js';
import { opencodeEngine } from './opencode.js';
import { piEngine } from './pi.js';

export { FakeEngine, demoScript } from './fake.js';
export { AUTONOMY_FLAGS, autonomyFlags } from './autonomy.js';
export { buildAgyArgv, parseLine as parseAgyLine } from './agy.js';
export { buildClaudeArgv, parseLine as parseClaudeLine } from './claude.js';
export { buildCodexArgv, parseLine as parseCodexLine } from './codex.js';
export { buildOpencodeArgv, finalizeOpencode, parseLine as parseOpencodeLine } from './opencode.js';
export { buildPiArgv, parseLine as parsePiLine } from './pi.js';
export { MAX_LINE_BYTES, binaryAvailable, runJsonlProcess } from './process.js';

const ENGINES: Record<CliId, Engine> = {
  claude: claudeEngine,
  codex: codexEngine,
  pi: piEngine,
  opencode: opencodeEngine,
  agy: agyEngine,
};

export function createEngine(cli: CliId): Engine { return ENGINES[cli]; }

export async function detectEngines(): Promise<CliId[]> {
  const results = await Promise.all(Object.entries(ENGINES).map(async ([cli, engine]) => [cli, await engine.available()] as const));
  return results.filter(([, available]) => available).map(([cli]) => cli as CliId);
}
