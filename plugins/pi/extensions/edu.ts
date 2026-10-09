import { spawnSync } from 'node:child_process';

export default function (pi: any): void {
  pi.registerMcpServer('edu', { command: 'edu', args: ['mcp'] });
  pi.on('before_agent_start', async (event: any) => {
    try {
      const result = spawnSync('edu', ['hook', 'session-start'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      if (result.error || result.status !== 0 || !result.stdout?.trim()) return;
      return { systemPrompt: `${event.systemPrompt ?? ''}\n\n${result.stdout.trim()}` };
    } catch { return; }
  });
}
