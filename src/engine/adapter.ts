import type { Engine, EngineRunRequest, CliId } from '../core/contracts.js';
import { binaryAvailable, runJsonlProcess, type CommandSpec } from './process.js';
import { engineCapabilities } from './autonomy.js';
import { measuredEngine } from './measurement.js';
import type { LineParser } from './process.js';

export function makeEngine(cli: CliId, binary: string, build: (req: EngineRunRequest) => CommandSpec, parser: LineParser): Engine {
  return measuredEngine({
    capabilities: engineCapabilities(cli),
    cli,
    available: () => binaryAvailable(binary),
    run: (req, agentId) => runJsonlProcess(build(req), req.cwd, agentId, (line, ctx) => parser(line, Object.assign(ctx, { cli })), req.signal),
  });
}

