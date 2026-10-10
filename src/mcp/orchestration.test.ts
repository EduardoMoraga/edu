import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { EduEvent, Engine } from '../core/contracts.js';
import { runWorker } from '../crew/index.js';
import { createCrewStore } from '../crew/store.js';
import { createEduMcpServer, TOOL_ANNOTATIONS } from './server.js';

const fake: Engine = { cli: 'claude', available: async () => true, async *run(request, agentId) {
  const text = request.prompt.includes('Create a safe') ? JSON.stringify({
    requirements: [{ id: 'R-1', text: 'Check passes' }],
    checks: [{ id: 'pass', requirementIds: ['R-1'], command: 'node -e "process.exit(0)"', expect: { exitCode: 0 }, timeoutMs: 1000 }],
    steps: [],
  }) : '{"verdict":"pass","issues":[]}';
  yield { type: 'agent.text', agentId, text, at: new Date().toISOString() } satisfies EduEvent;
  yield { type: 'agent.end', agentId, ok: true, summary: text, at: new Date().toISOString() } satisfies EduEvent;
} };

describe('orchestration MCP tools', () => {
  it('starts a job, exposes the spec, approves it, and returns the verified outcome', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'edu-mcp-orchestration-'));
    const root = join(cwd, '.edu');
    await mkdir(root);
    const store = createCrewStore(root);
    const server = createEduMcpServer({ locations: [{ scope: 'project', root }], crewOptions: {
      brainRoot: root, workspaceRoot: cwd, store, detectClis: async () => ['claude'], engineFactory: () => fake,
      startHeadless: async job => { void runWorker(job.id, { brainRoot: root, store, engineFactory: () => fake, detectClis: async () => ['claude'] }); return job; },
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
      expect(TOOL_ANNOTATIONS.edu_orchestrate).toMatchObject({ destructiveHint: true, openWorldHint: true });
      expect(TOOL_ANNOTATIONS.edu_crew_approve).toMatchObject({ destructiveHint: true, openWorldHint: true });
      const started = await call('edu_orchestrate', { goal: 'Check work' });
      expect(started.specPath).toContain('/specs/');
      expect(started.status).toBe('awaiting-approval');
      await call('edu_crew_approve', { jobId: started.jobId, approve: true });
      const result = await call('edu_crew_result', { jobId: started.jobId, waitSeconds: 10 });
      expect(result.status).toBe('done');
      expect(result.outcome).toBe('assisted_verified_success');
      expect(result.verificationSummary).toContain('passed');
      expect(result.specPath).toBe(started.specPath);
    } finally {
      await client.close();
      await server.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
