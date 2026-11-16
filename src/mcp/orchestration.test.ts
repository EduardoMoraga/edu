import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { saveChecks } from '../evidence/registry.js';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { EduEvent, Engine } from '../core/contracts.js';
import { runWorker } from '../crew/index.js';
import { createCrewStore } from '../crew/store.js';
import { createEduMcpServer, TOOL_ANNOTATIONS } from './server.js';
import { engineCapabilities } from '../engine/autonomy.js';

const fake: Engine = { cli: 'claude', capabilities: engineCapabilities('claude'), available: async () => true, async *run(request, agentId) {
  const text = request.prompt.includes('Create a safe') ? JSON.stringify({
    requirements: [{ id: 'R-1', text: 'Check passes' }],
    checks: [{ id: 'pass', requirementIds: ['R-1'], command: 'node -e "process.exit(0)"', expect: { exitCode: 0 }, timeoutMs: 10000 }],
    steps: [],
  }) : '{"verdict":"pass","issues":[]}';
  yield { type: 'agent.text', agentId, text, at: new Date().toISOString() } satisfies EduEvent;
  yield { type: 'agent.end', agentId, ok: true, summary: text, at: new Date().toISOString() } satisfies EduEvent;
} };

describe('orchestration MCP tools', () => {
  it('starts a job, exposes the spec and its requestId, approves it as the host LLM, and returns the verified outcome', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'edu-mcp-orchestration-'));
    const root = join(cwd, '.edu');
    await mkdir(root);
    // A registered check runs after any approval; a planner-invented one would need a person.
    await saveChecks(cwd, [{ id: 'pass', requirementIds: ['R-1'], command: 'node -e "process.exit(0)"', expect: { exitCode: 0 }, timeoutMs: 10000 }]);
    // The person's global home (policy, approvals) sits outside the workspace, never at the real ~/.edu.
    const globalRoot = join(cwd, '..', `${basename(cwd)}-home`);
    const store = createCrewStore(root, { globalRoot });
    const server = createEduMcpServer({ locations: [{ scope: 'project', root }], env: { HOME: dirname(globalRoot), EDU_HOME: globalRoot }, crewOptions: {
      brainRoot: root, workspaceRoot: cwd, store, detectClis: async () => ['claude'], engineFactory: () => fake,
      startHeadless: async (job, options) => { void runWorker(job.id, { brainRoot: root, globalRoot, policy: options.policy, store, engineFactory: () => fake, detectClis: async () => ['claude'] }); return job; },
    } });
    const client = new Client({ name: 'orchestration-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      return JSON.parse(result.content.find(item => item.type === 'text')?.text ?? '{}') as Record<string, unknown>;
    };
    try {
      const tools = (await client.listTools()).tools;
      expect(tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['edu_orchestrate', 'edu_crew_approve']));
      // The LLM cannot ask for auto-approval, and must name the gate it approves.
      expect(Object.keys(tools.find(tool => tool.name === 'edu_orchestrate')!.inputSchema.properties ?? {})).not.toContain('autoApprove');
      expect(tools.find(tool => tool.name === 'edu_crew_approve')!.inputSchema.required).toEqual(expect.arrayContaining(['jobId', 'requestId', 'approve']));
      expect(TOOL_ANNOTATIONS.edu_orchestrate).toMatchObject({ destructiveHint: true, openWorldHint: true });
      expect(TOOL_ANNOTATIONS.edu_crew_approve).toMatchObject({ destructiveHint: true, openWorldHint: true });
      const started = await call('edu_orchestrate', { goal: 'Check work', autoApprove: true });
      expect(started.specPath.replace(/\\/g, '/')).toContain('/specs/');
      expect(started.status).toBe('awaiting-approval');
      expect(started.requestId).toMatch(/^[0-9a-f-]{36}$/);
      const stale = await client.callTool({ name: 'edu_crew_approve', arguments: { jobId: started.jobId, requestId: 'guessed', approve: true } });
      expect(stale.isError).toBe(true);
      await call('edu_crew_approve', { jobId: started.jobId, requestId: started.requestId, approve: true });
      const result = await call('edu_crew_result', { jobId: started.jobId, waitSeconds: 10 });
      expect(result.status).toBe('done');
      // The host LLM is not a person: the run is not "assisted", and its decision is recorded as host-llm.
      expect(result.outcome).toBe('autonomous_verified_success');
      expect(await store.events(started.jobId as string)).toContainEqual(expect.objectContaining({ type: 'approval.resolve', approved: true, by: 'host-llm' }));
      expect(result.verificationSummary).toContain('passed');
      expect(result.specPath).toBe(started.specPath);
    } finally {
      await client.close();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
      await rm(globalRoot, { recursive: true, force: true });
    }
  });
});
