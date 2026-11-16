import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { compileReportLines } from '../brain/compile.js';
import { packageVersion } from '../platform/package.js';
import { registerCapabilityTools } from './tools/capabilities.js';
import { createToolContext, type EduMcpOptions } from './tools/context.js';
import { registerCrewTools } from './tools/crew.js';
import { registerMemoryTools } from './tools/memory.js';
import { registerOrchestrationTools } from './tools/orchestration.js';
import { registerProjectTools } from './tools/projects.js';
import { registerSessionTools } from './tools/sessions.js';

export type { EduMcpOptions } from './tools/context.js';
export { TOOL_ANNOTATIONS } from './tools/annotations.js';
export { MAX_RESULT_WAIT_SECONDS } from './tools/crew.js';
export { agentOfClient, detectCallerCli } from './caller.js';

/** Compact text of what compiling a new note found (shared with the CLI). */
export const compileReportText = compileReportLines;

export function createEduMcpServer(opts: EduMcpOptions): McpServer {
  const profile = opts.toolProfile ?? 'full';
  if (profile !== 'full' && profile !== 'memory') throw new Error('Unknown MCP tool profile; use full or memory');
  const version = packageVersion();
  const server = new McpServer({ name: 'edu', version });
  const { context, listed } = createToolContext(server, opts, profile, version);

  // Registration order is the tools/list order. The memory profile drops the crew and orchestration tools.
  registerMemoryTools(context);
  registerSessionTools(context);
  registerCapabilityTools(context);
  registerProjectTools(context);
  registerCrewTools(context);
  registerOrchestrationTools(context);

  // tools/list is what every host pays for in context on every turn. The SDK's own listing adds a `$schema` URL to
  // each input schema and `execution: {taskSupport: 'forbidden'}` (the protocol default); both carry no information
  // for a model, so the listing is published from the same registrations without them. Calls still go through the SDK.
  const tools: Tool[] = listed.map(({ name, description, inputSchema, annotations }) => {
    const { $schema: _schemaUrl, ...schema } = z.toJSONSchema(inputSchema, { target: 'draft-7', io: 'input' }) as Record<string, unknown>;
    return { name, description, inputSchema: schema as Tool['inputSchema'], ...(annotations ? { annotations } : {}) };
  });
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));

  return server;
}
