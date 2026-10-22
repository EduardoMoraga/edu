import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { assertContained, canonicalAnchor } from '../skills/bundle.js';
import { ISOLATION_LIMITS, parseManifest, protectedPath, sha256, type ArmResult, type ExperimentCommand } from './contract.js';
import { materialize, snapshot, snapshotDigests, snapshotHash, overlaySnapshot } from './workspace.js';

export async function inspectExperiment(manifest: string) {
  const spec = parseManifest(manifest);
  const inputs = await snapshot(spec.sourceRoot, spec.limits, true);
  overlaySnapshot(inputs, spec.overlay, spec.limits);
  return { manifestSha256: sha256(manifest), sourceSha256: snapshotHash(inputs),
    approvalReady: spec.sourceSha256 === snapshotHash(inputs), inputs: snapshotDigests(inputs), spec, limitations: ISOLATION_LIMITS };
}
const emptyArm = (): ArmResult => ({ status: 'not-run', durationMs: 0, exitCode: null, stdout: '', stderr: '', artifacts: {}, checks: [] });
export interface ExperimentDeps { approve: string; evidenceRoot: string; signal?: AbortSignal }

/** Exact-byte approval binds commands, overlays, expected artifacts, checks and frozen input hashes. */
export async function runExperiment(manifest: string, deps: ExperimentDeps) {
  if (sha256(manifest) !== deps.approve) throw new Error('Exact manifest approval SHA256 mismatch');
  const spec = parseManifest(manifest);
  const initial = await snapshot(spec.sourceRoot, spec.limits, true);
  if (snapshotHash(initial) !== spec.sourceSha256) throw new Error('Frozen source digest mismatch; inspect and approve fresh inputs');
  for (const path of spec.protected) if (![...initial.keys()].some(p => p === path || p.startsWith(path + '/'))) throw new Error(`Missing protected input: ${path}`);
  overlaySnapshot(initial, spec.overlay, spec.limits);
  for (const path of spec.artifacts) if (initial.has(path)) throw new Error(`Required artifact already exists in source: ${path}`);
  const protectedInventory = (files: typeof initial) => Object.fromEntries(Object.entries(snapshotDigests(files)).filter(([path]) => protectedPath(path, spec)));
  const frozen = protectedInventory(initial);
  if (!deps.evidenceRoot) throw new Error('An explicit evidence directory outside the source is required');
  const evidenceRoot = resolve(deps.evidenceRoot);
  const rel = relative(await canonicalAnchor(spec.sourceRoot), await canonicalAnchor(evidenceRoot));
  if (!rel || (!rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && rel !== '..' && !isAbsolute(rel))) {
    throw new Error('Evidence directory must be outside original source');
  }
  const root = await mkdtemp(join(tmpdir(), 'edu-experiment-'));
  const evidencePath = join(evidenceRoot, `${root.split(/[\\/]/).at(-1)}.json`);
  const result = {
    version: 1, state: 'running' as 'running' | 'complete', manifestSha256: sha256(manifest), spec, inputs: snapshotDigests(initial), overlaySha256: sha256(JSON.stringify(spec.overlay)),
    checksSha256: sha256(JSON.stringify(spec.checks)), protectedSha256: frozen,
    commandsSha256: sha256(JSON.stringify([spec.baseline, spec.candidate])), artifactsSha256: sha256(JSON.stringify(spec.artifacts)),
    isolation: 'workspace-copy', limitations: ISOLATION_LIMITS,
    startedAt: new Date().toISOString(), endedAt: '', evidencePath,
    usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, costUsd: null },
    arms: { baseline: emptyArm(), candidate: emptyArm() },
    decision: 'inconclusive' as 'inconclusive' | 'baseline' | 'candidate', fallbackUsable: false,
  };
  // Establish writable evidence storage before any process; an interrupted run
  // leaves an explicit incomplete record rather than disappearing.
  try {
    await mkdir(evidenceRoot, { recursive: true, mode: 0o700 }); await assertContained(evidenceRoot, evidencePath);
    await writeFile(evidencePath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
  try {
    // Materialize both from the same frozen buffers before executing either arm.
    for (const arm of ['baseline', 'candidate'] as const) await materialize(join(root, arm), initial);
    for (const arm of ['baseline', 'candidate'] as const) {
      if (deps.signal?.aborted) {
        if (arm === 'baseline') result.arms.baseline.status = 'cancelled';
        break;
      }
      const outcome = result.arms[arm]; outcome.initialSha256 = snapshotHash(initial);
      const cwd = join(root, arm);
      try {
        outcome.initialSha256 = snapshotHash(await snapshot(cwd, spec.limits));
        if (outcome.initialSha256 !== spec.sourceSha256) throw new Error('Initial workspace snapshot changed before execution');
        if (arm === 'candidate') for (const [path, content] of Object.entries(spec.overlay)) {
          await assertContained(cwd, join(cwd, path));
          await mkdir(dirname(join(cwd, path)), { recursive: true });
          await writeFile(join(cwd, path), content);
        }
        const before = await snapshot(cwd, spec.limits);
        if (JSON.stringify(protectedInventory(before)) !== JSON.stringify(frozen)) throw new Error('Protected inventory changed before execution');
        Object.assign(outcome, await execute(spec[arm], cwd, spec.limits, deps.signal));
        const final = await snapshot(cwd, spec.limits);
        if (JSON.stringify(protectedInventory(final)) !== JSON.stringify(frozen)) throw new Error('Protected inventory changed after execution');
        for (const path of spec.artifacts) {
          const artifact = final.get(path);
          if (artifact?.kind !== 'file') throw new Error(`Missing required artifact: ${path}`);
          outcome.artifacts[path] = sha256(artifact.bytes);
        }
        outcome.checks = spec.checks.map(check => ({ id: check.id, ok: outcome.artifacts[check.path] === check.sha256 }));
      } catch (error) {
        // Preserve the process failure reason when post-run validation also fails.
        if (outcome.status === 'ok' || outcome.status === 'not-run') outcome.status = 'invalid';
        outcome.error = error instanceof Error ? error.message : String(error);
      }
    }
    result.fallbackUsable = result.arms.baseline.status === 'ok';
    if (result.fallbackUsable) {
      result.decision = 'baseline';
      if (spec.criterion === 'artifact-match-gain' && result.arms.candidate.status === 'ok' &&
        result.arms.baseline.checks.some(c => !c.ok) && result.arms.candidate.checks.length > 0 && result.arms.candidate.checks.every(c => c.ok)) result.decision = 'candidate';
    }
  } catch (error) {
    result.arms.baseline.status = 'invalid'; result.arms.baseline.error = String(error);
  } finally {
    result.endedAt = new Date().toISOString(); result.state = 'complete';
    try {
      await mkdir(evidenceRoot, { recursive: true }); await assertContained(evidenceRoot, evidencePath);
      const staging = evidencePath + '.tmp'; await assertContained(evidenceRoot, staging);
      await writeFile(staging, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(staging, evidencePath);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  return result;
}

/** No shell, minimal environment; resource hygiene for trusted processes, not containment. */
async function execute(command: ExperimentCommand, cwd: string, limits: ReturnType<typeof parseManifest>['limits'], signal?: AbortSignal): Promise<Partial<ArmResult>> {
  const started = Date.now();
  if (signal?.aborted) return { status: 'cancelled', durationMs: 0, exitCode: null, stdout: '', stderr: '' };
  return new Promise(done => {
    let status: ArmResult['status'] = 'ok', stdout = '', stderr = '', used = 0, error: string | undefined;
    let exited = false, settled = false, closing = false, exitCode: number | null = null;
    let scanning: Promise<void> | undefined, drain: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(command.executable, command.args, { cwd, shell: false, detached: process.platform !== 'win32', windowsHide: true,
      env: Object.fromEntries(['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])), stdio: ['ignore', 'pipe', 'pipe'] });
    const kill = () => {
      if (!child.pid || settled) return;
      if (process.platform === 'win32') {
        if (exited) return; // An exited parent's PID no longer identifies our process.
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
        killer.on('error', () => {}); killer.unref();
      } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Group already exited. */ } }
    };
    const finish = () => {
      if (settled || closing) return;
      closing = true; clearTimeout(timer); clearTimeout(drain); clearInterval(monitor);
      signal?.removeEventListener('abort', abort);
      kill(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
      settled = true;
      // An in-flight scan can finish reading its disposable copy but cannot change
      // settled state or kill anything. Drain it before the caller removes the copy.
      void (scanning ?? Promise.resolve()).finally(() => done({
        status: status === 'ok' && exitCode !== 0 ? 'nonzero' : status, exitCode,
        durationMs: Date.now() - started, stdout, stderr, ...(error ? { error } : {}),
      }));
    };
    const stop = (reason: ArmResult['status']) => {
      if (settled || closing || status !== 'ok') return;
      status = reason;
      kill();
      // close is not guaranteed, particularly when an exited Windows parent left
      // inherited pipes in a descendant. Stop waiting after a bounded drain.
      drain ??= setTimeout(finish, 200);
    };
    const abort = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), limits.timeoutMs);
    const monitor = setInterval(() => {
      if (scanning || settled || closing) return;
      scanning = snapshot(cwd, limits, false, true).then(() => {}, e => {
        if (settled || closing) return;
        error = String(e); stop('invalid');
      }).finally(() => { scanning = undefined; });
    }, 100);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const collect = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      if (settled || closing) return;
      const keep = chunk.subarray(0, Math.max(0, limits.outputBytes - used)); used += chunk.length;
      if (stream === 'stdout') stdout += keep.toString('utf8'); else stderr += keep.toString('utf8');
      if (used > limits.outputBytes) stop('output-limit');
    };
    child.stdout.on('data', chunk => collect(chunk, 'stdout')); child.stderr.on('data', chunk => collect(chunk, 'stderr'));
    child.once('error', e => { if (!settled && !closing) { error = e.message; status = 'invalid'; finish(); } });
    child.once('exit', code => { exited = true; if (!settled && !closing) exitCode = code; });
    child.once('close', code => { if (!settled && !closing) { exitCode = code; finish(); } });
  });
}
