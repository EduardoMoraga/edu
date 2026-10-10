// Starts Edu's MCP server exactly as a host CLI would on this platform and checks it answers.
import { spawn } from 'node:child_process';

const launch = process.platform === 'win32' ? ['cmd', ['/c', 'edu', 'mcp']] : ['edu', ['mcp']];
const child = spawn(launch[0], launch[1], { stdio: ['pipe', 'pipe', 'inherit'] });
const timer = setTimeout(() => { console.error('MCP smoke: timed out'); child.kill(); process.exit(1); }, 30_000);
let buffer = '';
const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id === 1) {
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    } else if (msg.id === 2) {
      const names = msg.result.tools.map((t) => t.name);
      if (!names.includes('edu_recall') || !names.includes('edu_crew_dispatch')) { console.error('MCP smoke: missing tools', names); process.exit(1); }
      console.log(`MCP smoke passed via ${launch[0]} ${launch[1].join(' ')}: ${names.length} tools`);
      clearTimeout(timer);
      child.kill();
      process.exit(0);
    }
  }
});
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'edu-smoke', version: '1' } } });
