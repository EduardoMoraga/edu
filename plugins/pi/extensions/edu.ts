// Edu for Pi: MCP server, identity at agent start, and the live Edu Deck (header, crew widget, footer,
// /edu-deck overlay). Generated into plugins/pi/extensions by scripts/build-plugins.ts.
import { execFile, spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import { Key, matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

// On Windows, npm installs edu as a .cmd shim: start it through cmd (fixed arguments only).

/** Edu's tagline, Spanish when EDU_LANG or the POSIX locale says so (same rule as the CLI). */
const TAGLINE = (() => {
  const env = process.env;
  const lang = (env.EDU_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || '').toLowerCase();
  return lang.startsWith('es') ? 'tu agente orquestador, con memoria propia' : 'your orchestrator agent, with a memory of its own';
})();

const windows = process.platform === 'win32';
const EDU = process.env.EDU_BIN || 'edu';
const REFRESH_MS = 3000;
const DECK_TIMEOUT_MS = 1500;

/** `edu deck --json` contract, version 1. Everything is optional here: an older edu degrades to identity only. */
interface DeckJob { id: string; cli: string; task: string; status: string; mode: string; startedAt: number; endedAt: number | null; tokens: number }
interface Deck {
  version: 1;
  project: { name: string; root: string };
  identity: string;
  brain: { present: boolean; canonical: number; proposed: number; toApprove?: number; episodic: number; transitive: number; lessons: number };
  /** edu ≥ 0.7: last auto-maintenance stamp and commitments currently overdue. */
  maintenance?: { lastRun: number | null; promoted: number; retired: number; overdue: number };
  spec: { name: string; requirements: number; checks: number } | null;
  jobs: DeckJob[];
  approvals: number;
  recent: Array<{ title: string; tier: string; at: number }>;
  updatedAt: number;
}

type Color = 'accent' | 'success' | 'warning' | 'error' | 'muted' | 'dim' | 'text' | 'border' | 'borderAccent';
interface Component { render(width: number): string[]; invalidate(): void; dispose?(): void }
interface Renderer { requestRender(): void }

const ACTIVE = new Set(['running', 'queued', 'awaiting-approval']);
const GLYPH: Record<string, [string, Color]> = {
  running: ['●', 'accent'],
  queued: ['○', 'muted'],
  'awaiting-approval': ['⏸', 'warning'],
  done: ['✓', 'success'],
  failed: ['✗', 'error'],
  cancelled: ['⊘', 'muted'],
};

const elapsed = (from: number, to: number): string => {
  const s = Math.max(0, Math.round((to - from) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
};
/** Coarse age for maintenance stamps: just now · 5m · 3h · 2d. */
const ago = (from: number, to: number): string => {
  const m = Math.max(0, Math.floor((to - from) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
};
/** Attention badges, empty when nothing needs the human: proposals to approve (warning) and overdue commitments. */
const attention = (deck: Deck, t: Theme): string[] => {
  const toApprove = deck.brain.toApprove ?? 0;
  const overdue = deck.maintenance?.overdue ?? 0;
  return [
    ...(toApprove > 0 ? [t.fg('warning', `${toApprove} to approve`)] : []),
    ...(overdue > 0 ? [t.fg('error', `${overdue} overdue`)] : []),
  ];
};
const compact = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))).replace('.0', '');
const bar = (percent: number, width: number): [string, string] => {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width);
  return ['▰'.repeat(filled), '▱'.repeat(width - filled)];
};
/** Like spread, but the left side is cut first so the right side (branch, crew) stays visible. */
const pinRight = (left: string, right: string, width: number): string => {
  const room = width - visibleWidth(right) - 1;
  if (!right || room < 12) return spread(left, right, width);
  const head = visibleWidth(left) > room ? truncateToWidth(left, room, '…') : left;
  return head + ' '.repeat(Math.max(1, width - visibleWidth(head) - visibleWidth(right))) + right;
};
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
const fit = (line: string, width: number): string => truncateToWidth(line, Math.max(0, width), '…');
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
/** Left and right segments on one row; the right side is dropped before the left is cut. */
const spread = (left: string, right: string, width: number): string => {
  const gap = width - visibleWidth(left) - visibleWidth(right);
  return gap >= 1 ? left + ' '.repeat(gap) + right : fit(left, width);
};

function parseDeck(stdout: string): Deck | undefined {
  try {
    const value = JSON.parse(stdout) as Partial<Deck>;
    if (value?.version !== 1 || !value.brain || !Array.isArray(value.jobs)) return undefined;
    return { recent: [], approvals: 0, spec: null, ...value } as Deck;
  } catch { return undefined; }
}

/** Never throws, never blocks the TUI: resolves undefined when edu is missing, old, slow or failing. */
function fetchDeck(cwd: string): Promise<Deck | undefined> {
  return new Promise(resolve => {
    try {
      const args = windows ? ['deck', '--json'] : ['deck', '--json', '--cwd', cwd];
      execFile(EDU, args, { cwd, timeout: DECK_TIMEOUT_MS, shell: windows, windowsHide: true, encoding: 'utf8', maxBuffer: 1 << 20 },
        (error, stdout) => resolve(error ? undefined : parseDeck(stdout)));
    } catch { resolve(undefined); }
  });
}

/** Two-row block wordmark, drawn in the accent. */
const WORDMARK = ['█▀▀ █▀▄ █ █', '██▄ █▄▀ █▄█'];

function brainLine(deck: Deck, t: Theme): string {
  const b = deck.brain;
  if (!b.present) return t.fg('muted', 'no brain here · run ') + t.fg('text', 'edu init');
  const sep = t.fg('dim', ' · ');
  return [
    t.fg('success', `${b.canonical} canonical`),
    ...(b.proposed ? [t.fg('warning', `${b.proposed} proposed`)] : []),
    t.fg('text', `${b.episodic} episodic`),
    t.fg('muted', `${b.transitive} transitive`),
  ].join(sep);
}

/** Header stats: project · brain c/p/e/t · to approve/overdue (only when > 0) · crew running/approvals · spec. */
function statsLine(deck: Deck | undefined, cwd: string, t: Theme): string {
  const sep = t.fg('dim', ' · ');
  const slash = t.fg('dim', '/');
  if (!deck) return t.fg('text', t.bold(basename(cwd))) + sep + t.fg('dim', 'deck needs edu ≥ 0.6');
  const parts = [t.fg('text', t.bold(deck.project.name))];
  const b = deck.brain;
  if (!b.present) return [...parts, t.fg('muted', 'no brain here · edu init')].join(sep);
  parts.push(t.fg('muted', 'brain ') + [t.fg('success', String(b.canonical)), t.fg('warning', String(b.proposed)), t.fg('text', String(b.episodic)), t.fg('muted', String(b.transitive))].join(slash));
  parts.push(...attention(deck, t)); // before crew/spec so it survives narrow truncation
  const running = deck.jobs.filter(job => job.status === 'running').length;
  parts.push(t.fg('muted', 'crew ') + t.fg(running ? 'accent' : 'muted', String(running)) + slash + t.fg(deck.approvals ? 'warning' : 'muted', String(deck.approvals)));
  if (deck.spec) parts.push(t.fg('muted', 'spec ') + t.fg('text', deck.spec.name));
  return parts.join(sep);
}

function jobLine(job: DeckJob, t: Theme, width: number, now: number): string {
  const [mark, color] = GLYPH[job.status] ?? ['?', 'muted'];
  const right = t.fg('dim', `${job.tokens ? `${compact(job.tokens)} · ` : ''}${elapsed(job.startedAt, job.endedAt ?? now)}`);
  const head = `${t.fg(color, mark)} ${t.fg('text', t.bold(job.cli))} ${t.fg('dim', job.mode)} `;
  const room = width - visibleWidth(head) - visibleWidth(right) - 1;
  const task = room > 3 ? truncateToWidth(oneLine(job.task), room, '…') : '';
  return spread(head + t.fg('text', task), right, width);
}

export default function (pi: ExtensionAPI): void {
  pi.registerMcpServer('edu', windows ? { command: 'cmd', args: ['/c', 'edu', 'mcp'] } : { command: 'edu', args: ['mcp'] });
  pi.on('before_agent_start', async (event: any) => {
    try {
      const result = spawnSync(EDU, ['hook', 'session-start'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], shell: windows });
      if (result.error || result.status !== 0 || !result.stdout?.trim()) return;
      return { systemPrompt: `${event.systemPrompt ?? ''}\n\n${result.stdout.trim()}` };
    } catch { return; }
  });

  let deck: Deck | undefined;
  let cwd = process.cwd();
  let ui: ExtensionContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let inflight = false;
  let widgetShown = false;
  const renderers = new Set<Renderer>();
  const watch = (tui: Renderer): (() => void) => { renderers.add(tui); return () => { renderers.delete(tui); }; };
  const repaint = () => { for (const tui of renderers) { try { tui.requestRender(); } catch { /* A closed component stops listening. */ } } };

  const crewWidget = (): ((tui: any, theme: Theme) => Component) => (tui, t) => {
    const stop = watch(tui);
    return {
      render(width: number): string[] {
        if (!deck) return [];
        const now = Date.now();
        const active = deck.jobs.filter(job => ACTIVE.has(job.status));
        const lines = active.slice(0, 4).map(job => jobLine(job, t, width, now));
        if (active.length > 4) lines.push(fit(t.fg('dim', `  +${active.length - 4} more · /edu-deck`), width));
        if (deck.approvals) lines.push(fit(t.fg('warning', `⏸ ${plural(deck.approvals, 'job')} waiting for approval`) + t.fg('dim', ' · edu crew approve <id>'), width));
        return lines;
      },
      invalidate() {},
      dispose: stop,
    };
  };

  /** The crew widget exists only while there is something to watch. */
  const syncWidget = () => {
    if (!ui) return;
    const wanted = !!deck && (deck.approvals > 0 || deck.jobs.some(job => ACTIVE.has(job.status)));
    if (wanted === widgetShown) return;
    widgetShown = wanted;
    try { ui.ui.setWidget('edu-deck', wanted ? crewWidget() : undefined, { placement: 'aboveEditor' }); } catch { /* UI gone. */ }
  };

  const refresh = async () => {
    if (inflight) return;
    inflight = true;
    try {
      const next = await fetchDeck(cwd);
      // A failed refresh keeps the last good snapshot instead of flickering to empty.
      if (next || !deck) deck = next;
      syncWidget();
      repaint();
    } finally { inflight = false; }
  };

  const header = (tui: any, t: Theme): Component => {
    const stop = watch(tui);
    return {
      render(width: number): string[] {
        const name = t.fg('accent', t.bold(deck?.identity ?? 'Edu'));
        const project = deck ? deck.project.name : basename(cwd);
        if (width < 44) return ['', fit(`${t.fg('accent', '◆')} ${name}${t.fg('dim', ' · ')}${t.fg('text', project)}`, width), ''];
        const hint = t.fg('dim', '/edu-deck');
        const first = `${t.fg('accent', WORDMARK[0]!)}  ${name}${t.fg('dim', ` — ${TAGLINE}`)}`;
        const second = `${t.fg('accent', WORDMARK[1]!)}  ${statsLine(deck, cwd, t)}`;
        return ['', spread(` ${first}`, hint, width), fit(` ${second}`, width), ''];
      },
      invalidate() {},
      dispose: stop,
    };
  };

  const footer = (ctx: ExtensionContext) => (tui: any, t: Theme, data: any): Component => {
    const stop = watch(tui);
    const unbranch = typeof data?.onBranchChange === 'function' ? data.onBranchChange(() => tui.requestRender()) : undefined;
    return {
      render(width: number): string[] {
        let input = 0, output = 0, cost = 0;
        try {
          for (const entry of ctx.sessionManager.getBranch() as any[]) {
            if (entry?.type === 'message' && entry.message?.role === 'assistant') {
              input += entry.message.usage?.input ?? 0;
              output += entry.message.usage?.output ?? 0;
              cost += entry.message.usage?.cost?.total ?? 0;
            }
          }
        } catch { /* Usage is decorative. */ }
        const sep = t.fg('dim', ' · ');
        const usage = (() => { try { return ctx.getContextUsage(); } catch { return undefined; } })();
        let context = t.fg('dim', 'ctx —');
        if (usage && usage.percent !== null) {
          const percent = Math.round(usage.percent);
          const tone: Color = percent > 80 ? 'error' : percent > 60 ? 'warning' : 'success';
          const [full, empty] = bar(percent, width >= 100 ? 10 : 6);
          context = `${t.fg(tone, full)}${t.fg('dim', empty)} ${t.fg('text', `${percent}%`)}${width >= 110 ? t.fg('dim', `/${compact(usage.contextWindow)}`) : ''}`;
        }
        const left = [
          t.fg('accent', '◆ edu'),
          t.fg('text', ctx.model?.id ?? 'no model'),
          context,
          t.fg('muted', `↑${compact(input)} ↓${compact(output)}`) + (cost ? t.fg('muted', ` $${cost.toFixed(cost < 1 ? 3 : 2)}`) : ''),
        ].join(sep);
        const branch = data?.getGitBranch?.();
        const crew = deck?.jobs.filter(job => job.status === 'running').length ?? 0;
        const right = [
          ...(crew ? [t.fg('accent', `● ${crew}`)] : []),
          ...(deck?.approvals ? [t.fg('warning', `⏸ ${deck.approvals}`)] : []),
          ...(branch ? [t.fg('muted', `⎇ ${branch}`)] : []),
        ].join(' ');
        const lines = [fit(width >= 90 ? pinRight(left, right, width) : spread(left, right, width), width)];
        const statuses: string[] = [];
        try { for (const text of (data?.getExtensionStatuses?.() as Map<string, string> | undefined)?.values() ?? []) if (text) statuses.push(text); } catch { /* none */ }
        if (statuses.length) lines.push(fit(t.fg('dim', statuses.join(' · ')), width));
        return lines;
      },
      invalidate() {},
      dispose() { stop(); unbranch?.(); },
    };
  };

  const overlay = (ctx: ExtensionContext) => (tui: any, t: Theme, _kb: unknown, done: (value: void) => void): Component & { handleInput(data: string): void } => {
    const stop = watch(tui);
    return {
      handleInput(data: string) {
        if (matchesKey(data, Key.escape) || data === 'q' || data === 'Q') done();
      },
      render(width: number): string[] {
        const w = Math.max(24, Math.min(width, 84));
        const inner = w - 4;
        const now = Date.now();
        const row = (content = '') => {
          const body = fit(content, inner);
          return `${t.fg('border', '│')} ${body}${' '.repeat(Math.max(0, inner - visibleWidth(body)))} ${t.fg('border', '│')}`;
        };
        const title = ` ${t.fg('accent', t.bold('◆ EDU DECK'))} `;
        const project = deck ? ` ${t.fg('muted', deck.project.name)} ` : '';
        const fill = Math.max(0, w - 3 - visibleWidth(title) - visibleWidth(project));
        const lines = [t.fg('border', '╭─') + title + t.fg('border', '─'.repeat(fill)) + project + t.fg('border', '╮')];
        const section = (name: string, right = '') => lines.push(row(spread(t.fg('accent', t.bold(name)), t.fg('dim', right), inner)));

        const usage = (() => { try { return ctx.getContextUsage(); } catch { return undefined; } })();
        section('CONTEXT', usage ? `window ${compact(usage.contextWindow)}` : '');
        if (usage && usage.percent !== null) {
          const percent = Math.round(usage.percent);
          const [full, empty] = bar(percent, Math.max(8, Math.min(28, inner - 22)));
          const tone: Color = percent > 80 ? 'error' : percent > 60 ? 'warning' : 'success';
          lines.push(row(`${t.fg(tone, full)}${t.fg('dim', empty)} ${t.fg('text', t.bold(`${percent}%`))} ${t.fg('dim', `${compact(usage.tokens ?? 0)}/${compact(usage.contextWindow)}`)}`));
        } else lines.push(row(t.fg('muted', 'waiting for the first response…')));

        if (!deck) {
          lines.push(row());
          lines.push(row(t.fg('muted', 'Edu Deck needs `edu deck` (edu ≥ 0.6). Update edu, then reopen.')));
        } else {
          const b = deck.brain;
          lines.push(row());
          section('BRAIN', b.present ? `${plural(b.canonical + b.proposed + b.episodic + b.transitive, 'note')} · ${plural(b.lessons, 'lesson')}` : '');
          lines.push(row(b.present ? brainLine(deck, t) : t.fg('muted', 'No Edu brain here. Run `edu init` in this folder.')));
          if (b.present) {
            const m = deck.maintenance;
            const upkeep = [
              ...attention(deck, t),
              ...(m?.lastRun ? [t.fg('dim', `maintained ${ago(m.lastRun, now)}`)] : []),
              ...(m?.lastRun && m.promoted ? [t.fg('success', `${m.promoted} promoted`)] : []),
              ...(m?.lastRun && m.retired ? [t.fg('muted', `${m.retired} retired`)] : []),
            ];
            if (upkeep.length) lines.push(row(upkeep.join(t.fg('dim', ' · '))));
          }
          if (deck.spec) {
            lines.push(row());
            section('SPEC', `${plural(deck.spec.requirements, 'requirement')} · ${plural(deck.spec.checks, 'check')}`);
            lines.push(row(t.fg('text', deck.spec.name)));
          }
          lines.push(row());
          const active = deck.jobs.filter(job => ACTIVE.has(job.status)).length;
          section('CREW', deck.jobs.length ? `${active} active · ${deck.jobs.length} recent` : '');
          if (!deck.jobs.length) lines.push(row(t.fg('muted', 'No crew jobs yet. Try: "delegate to codex …" or /edu-run')));
          for (const job of deck.jobs.slice(0, 8)) lines.push(row(jobLine(job, t, inner, now)));
          if (deck.recent.length) {
            lines.push(row());
            section('RECENT');
            for (const note of deck.recent.slice(0, 5)) {
              const tone: Color = note.tier === 'canonical' ? 'success' : note.tier === 'episodic' ? 'text' : 'muted';
              const right = t.fg('dim', `${elapsed(note.at, now)} ago`);
              const head = `${t.fg(tone, '◆')} ${t.fg('dim', note.tier.padEnd(10))} `;
              const room = inner - visibleWidth(head) - visibleWidth(right) - 1;
              lines.push(row(spread(head + t.fg('text', truncateToWidth(oneLine(note.title), Math.max(0, room), '…')), right, inner)));
            }
          }
        }
        lines.push(row());
        lines.push(row(t.fg('dim', `esc close · live every ${REFRESH_MS / 1000}s${deck ? ` · updated ${elapsed(deck.updatedAt, now)} ago` : ''}`)));
        lines.push(t.fg('border', `╰${'─'.repeat(w - 2)}╯`));
        return lines.map(line => fit(line, width));
      },
      invalidate() {},
      dispose: stop,
    };
  };

  pi.on('session_start', async (_event: unknown, ctx: ExtensionContext) => {
    cwd = ctx.cwd || process.cwd();
    if (ctx.mode !== 'tui') return;
    ui = ctx;
    widgetShown = false;
    try {
      ctx.ui.setHeader(header);
      ctx.ui.setFooter(footer(ctx));
    } catch { /* Older Pi without these hooks still gets MCP and identity. */ }
    if (timer) clearInterval(timer);
    timer = setInterval(() => { void refresh(); }, REFRESH_MS);
    timer.unref?.();
    void refresh();
  });
  pi.on('turn_end', async () => { if (ui) void refresh(); });
  pi.on('agent_end', async () => { if (ui) void refresh(); });
  pi.on('session_shutdown', async () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    ui = undefined;
    renderers.clear();
  });

  pi.registerCommand('edu-deck', {
    description: 'Open the Edu Deck: context, brain, spec, crew and recent notes',
    handler: async (_args: string, ctx: any) => {
      if (ctx.mode !== 'tui') {
        const next = await fetchDeck(ctx.cwd || cwd);
        ctx.ui?.notify?.(next ? `Edu · ${next.project.name}: ${next.jobs.length} jobs, ${next.approvals} approvals` : 'Edu Deck needs `edu deck` (edu ≥ 0.6).', 'info');
        return;
      }
      void refresh();
      await ctx.ui.custom(overlay(ctx), { overlay: true });
    },
  });
}
