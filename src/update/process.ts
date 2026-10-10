/** Real child-process runner for `edu update` (cross-spawn: handles npm.cmd on Windows without a shell string). */
import spawn from 'cross-spawn';
import type { Runner } from './update.js';

export const spawnRunner: Runner = (command, args, opts = {}) => new Promise((resolve) => {
  const child = spawn(command, args, { env: opts.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs) : undefined;
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
  child.on('error', (error) => { if (timer) clearTimeout(timer); resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` }); });
  child.on('close', (code, signal) => { if (timer) clearTimeout(timer); resolve({ code: code ?? (signal ? 1 : 0), stdout, stderr: signal ? `${stderr}\nterminated by ${signal}` : stderr }); });
});
