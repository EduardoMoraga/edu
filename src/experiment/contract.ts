import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
export function workspacePath(path: string): string {
  const parts = path.split('/');
  if (!path || path.length > 1024 || parts.length > 32 || parts.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f\x7f<>:"\\|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`Invalid portable workspace path: ${path}`);
  return path;
}
export const pathKey = (path: string) => path.normalize('NFC').toLowerCase();
const Path = z.string().refine(value => { try { workspacePath(value); return true; } catch { return false; } }, 'Invalid portable experiment path');
const Command = z.object({ executable: z.string().min(1).refine(isAbsolute, 'Use an absolute trusted executable path'), args: z.array(z.string()).max(256) }).strict();
export const ExperimentSchema = z.object({
  version: z.literal(1),
  sourceRoot: z.string().refine(isAbsolute, 'sourceRoot must be absolute'), sourceSha256: Digest,
  baseline: Command, candidate: Command,
  overlay: z.record(Path, z.string()).default({}),
  protected: z.array(Path).max(256).default([]),
  artifacts: z.array(Path).min(1).max(64),
  checks: z.array(z.object({ id: z.string().min(1).max(100), path: Path, sha256: Digest }).strict()).max(64).default([]),
  criterion: z.enum(['retain-baseline', 'artifact-match-gain']).default('retain-baseline'),
  isolation: z.literal('workspace-copy'),
  limits: z.object({
    timeoutMs: z.number().int().min(10).max(600_000), outputBytes: z.number().int().min(1).max(4 * 1024 * 1024),
    workspaceBytes: z.number().int().min(1).max(128 * 1024 * 1024), files: z.number().int().min(1).max(4096),
  }).strict(),
}).strict();
export type ExperimentSpec = z.infer<typeof ExperimentSchema>;
export type ExperimentCommand = ExperimentSpec['baseline'];
export type ArmStatus = 'not-run' | 'ok' | 'invalid' | 'nonzero' | 'timeout' | 'cancelled' | 'output-limit';
export interface ArmResult {
  status: ArmStatus; initialSha256?: string; durationMs: number; exitCode: number | null;
  stdout: string; stderr: string; error?: string;
  artifacts: Record<string, string>; checks: Array<{ id: string; ok: boolean }>;
}
export const ISOLATION_LIMITS = [
  'Trusted commands only; shell is disabled but approved executables can run arbitrary code.',
  'Disposable workspace copies are not an OS, filesystem-permission or network sandbox.',
  'Commands can access host files and network. Enforced isolation requirements are unsupported.',
  'Workspace limits are checked during and after execution, not an OS disk quota; transient writes can exceed them.',
  'Process-group cleanup is best effort; hostile commands can escape it. No automatic models or adoption.',
];
export function parseManifest(manifest: string): ExperimentSpec {
  if (Buffer.byteLength(manifest) > 2 * 1024 * 1024) throw new Error('Experiment manifest exceeds 2 MiB');
  const spec = ExperimentSchema.parse(JSON.parse(manifest));
  if (new Set(spec.artifacts.map(pathKey)).size !== spec.artifacts.length || new Set(spec.checks.map(c => c.id)).size !== spec.checks.length) throw new Error('Duplicate artifact or check');
  if (spec.checks.some(check => !spec.artifacts.includes(check.path))) throw new Error('Checks must reference declared artifacts');
  for (const [path, content] of Object.entries(spec.overlay)) {
    if (content.includes('\0') || new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(content)) !== content) throw new Error(`Overlay must be UTF-8 text: ${path}`);
    if (spec.artifacts.some(artifact => pathKey(artifact) === pathKey(path) || pathKey(artifact).startsWith(pathKey(path) + '/') || pathKey(path).startsWith(pathKey(artifact) + '/'))) throw new Error(`Overlay cannot provide required artifacts: ${path}`);
    if (protectedPath(path, spec)) throw new Error(`Overlay cannot change protected path: ${path}`);
  }
  return spec;
}
/** Dependency/evaluator files are protected even when omitted from the explicit list. */
export function protectedPath(path: string, spec: ExperimentSpec): boolean {
  const parts = path.split('/').map(p => p.toLowerCase());
  const brain = parts.indexOf('.edu');
  const knownPolicy = parts.some(p => /^(?:agents\.md|claude\.md|gemini\.md|edu\.md|\.mcp\.json|\.claude-plugin|\.codex-plugin|\.codex|\.claude|\.pi|\.gemini|\.git|node_modules)$/.test(p)) ||
    parts.some((p, i) => p === '.agents' && parts[i + 1] === 'plugins' || p === '.config' && parts[i + 1] === 'opencode') ||
    brain >= 0 && /^(?:config\.json|edu\.md|manifest\.json|plugin-setup\.json|harness)$/.test(parts[brain + 1] ?? '');
  return knownPolicy || spec.protected.some(p => pathKey(path) === pathKey(p) || pathKey(path).startsWith(pathKey(p) + '/') || pathKey(p).startsWith(pathKey(path) + '/')) || path.split('/').some(p => /^(?:checks?|evaluators?|tests?|__tests__|package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|requirements.*\.txt|pyproject\.toml|Cargo\.(?:toml|lock)|.*\.(?:test|spec)\.[cm]?[jt]sx?|(?:vitest|jest)\.config\..*)$/i.test(p));
}
