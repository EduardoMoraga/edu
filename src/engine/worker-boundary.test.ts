import { expect, it } from 'vitest';
import { runJsonlProcess } from './process.js';

it('propagates the exact Edu worker ID to a real child without changing parent environment', async () => {
  const before = process.env.EDU_CREW_JOB;
  let value = '';
  for await (const _event of runJsonlProcess({ command: process.execPath, args: ['-e', 'console.log(JSON.stringify(process.env.EDU_CREW_JOB))'] }, process.cwd(), 'exact-worker-session', line => { value = JSON.parse(line); return []; })) { /* drain */ }
  expect(value).toBe('exact-worker-session');
  expect(process.env.EDU_CREW_JOB).toBe(before);
});
