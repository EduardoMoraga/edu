import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import type { CliContext } from '../context.js';
import { action, printJson } from '../kit.js';
import { inspectExperiment, runExperiment } from '../../experiment/run.js';

async function manifest(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('Manifest must be a regular UTF-8 JSON file <= 2 MiB');
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(path));
}
export function registerExperiment(program: Command, ctx: CliContext): void {
  const command = program.command('experiment').description('explicitly approved trusted commands in disposable workspace copies (no OS sandbox)');
  command.command('inspect').argument('<manifest>').description('read-only manifest, inventory and approval hash; prints JSON')
    .action(action(ctx, async ({ g }, path) => { printJson(ctx, await inspectExperiment(await manifest(resolve(g.cwd, path!)))); }));
  command.command('run').argument('<manifest>').description('run both approved arms; retain JSON evidence without activating changes')
    .requiredOption('--approve <sha256>', 'SHA-256 of the exact inspected manifest bytes')
    .requiredOption('--evidence <directory>', 'explicit retained evidence directory outside the original source tree')
    .action(action<{ approve: string; evidence: string }>(ctx, async ({ g, opts }, path) => {
      const controller = new AbortController(); const cancel = () => controller.abort();
      process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
      try {
        const result = await runExperiment(await manifest(resolve(g.cwd, path!)), { approve: opts.approve, evidenceRoot: resolve(g.cwd, opts.evidence), signal: controller.signal });
        printJson(ctx, result);
        if (Object.values(result.arms).some(arm => arm.status !== 'ok')) ctx.setExitCode(1);
      } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
    }));
}
