/** `edu brain proposals|approve`: a person reviews the canonical notes proposed for approval. */
import type { Command } from 'commander';
import { listCanonicalProposals, reviewCanonicalProposals } from '../../../brain/proposals.js';
import { isCrewWorker } from '../../../crew/store.js';
import type { CliContext } from '../../context.js';
import { action, look, printJson } from '../../kit.js';
import { openWorkspace } from '../../workspace.js';
import { collect } from './shared.js';

const REVIEW = {
  en: {
    none: 'Nothing to approve: no proposed canonical notes.',
    header: '{count} proposed canonical note(s) waiting for you:',
    hint: 'Approve: edu brain approve <id> | --all   ·   Reject: edu brain approve --reject <id>',
    accepted: 'Accepted {id}',
    rejected: 'Rejected {id} (deleted; recorded in episodic)',
    failed: 'Could not review {id}: {error}',
    nothing: 'Say what to review: edu brain approve <id...> | --all | --reject <id>',
    summary: '{accepted} accepted · {rejected} rejected · {errors} error(s)',
    worker: 'A crew worker cannot approve or reject canonical notes; a person decides them.',
    needTty: 'Approving canonical notes is a person\'s decision: run it in a terminal, or pass --yes to confirm you are that person.',
  },
  es: {
    none: 'Nada que aprobar: no hay notas canónicas propuestas.',
    header: '{count} nota(s) canónica(s) propuesta(s) esperan tu aprobación:',
    hint: 'Aprobar: edu brain approve <id> | --all   ·   Rechazar: edu brain approve --reject <id>',
    accepted: 'Aceptada {id}',
    rejected: 'Rechazada {id} (borrada; queda registro en episodic)',
    failed: 'No se pudo revisar {id}: {error}',
    nothing: 'Indica qué revisar: edu brain approve <id...> | --all | --reject <id>',
    summary: '{accepted} aceptadas · {rejected} rechazadas · {errors} error(es)',
    worker: 'Un worker del crew no puede aprobar ni rechazar notas canónicas; las decide una persona.',
    needTty: 'Aprobar notas canónicas lo decide una persona: ejecútalo en una terminal, o pasa --yes para confirmar que eres esa persona.',
  },
} as const;
const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));

interface ApproveOpts { all?: boolean; reject?: string[]; reason?: string; json?: boolean; yes?: boolean }

export function registerBrainReview(brain: Command, ctx: CliContext): void {
  brain
    .command('proposals')
    .description('canonical notes proposed for your approval (title, source, band, why)')
    .option('--json', 'machine-readable output')
    .action(
      action<{ json?: boolean }>(ctx, async ({ g, opts }) => {
        const ws = await openWorkspace(ctx, g.cwd);
        const items = await listCanonicalProposals(ws.brain);
        if (g.json || opts.json) return printJson(ctx, items);
        const m = REVIEW[g.lang];
        if (!items.length) return ctx.out(m.none);
        const { glyphs } = look(ctx);
        ctx.out(fill(m.header, { count: items.length }));
        for (const p of items) {
          ctx.out(`  ${p.id}  ${p.title}`);
          ctx.out(`      ${p.band} ${glyphs.sep} ${p.source} ${glyphs.sep} ${p.why}`);
        }
        ctx.out('');
        ctx.out(m.hint);
      }),
    );

  brain
    .command('approve')
    .description('accept proposed canonical notes (ids or --all) or reject them (--reject <id>, repeatable)')
    .argument('[ids...]', 'proposal ids to accept (see: edu brain proposals)')
    .option('--all', 'accept every pending proposal (except those passed to --reject)')
    .option('--reject <id>', 'reject a proposal: deleted, with a record in episodic memory (repeatable)', collect, [])
    .option('--reason <text>', 'why the rejected proposals were wrong (kept in the record)')
    .option('--yes', 'confirm a person is deciding when stdin is not a terminal (scripts)')
    .option('--json', 'machine-readable output')
    .action(
      action<ApproveOpts>(ctx, async ({ g, opts, cmd }) => {
        const ids = (cmd.args as string[]).filter(Boolean);
        const reject = opts.reject ?? [];
        const m = REVIEW[g.lang];
        // Canonical notes are human-approved truth: never from a crew worker, and never silently from a pipe.
        if (isCrewWorker(ctx.env)) throw new Error(m.worker);
        if (!ctx.stdinIsTTY && !opts.yes) throw new Error(m.needTty);
        if (!ids.length && !opts.all && !reject.length) throw new Error(m.nothing);
        const ws = await openWorkspace(ctx, g.cwd);
        const result = await reviewCanonicalProposals(ws.brain, { approve: ids, all: Boolean(opts.all), reject, reason: opts.reason });
        if (result.accepted.length || result.rejected.length) await ws.brain.rebuildIndex();
        if (result.errors.length) ctx.setExitCode(1);
        if (g.json || opts.json) return printJson(ctx, result);
        if (!result.accepted.length && !result.rejected.length && !result.errors.length) return ctx.out(m.none);
        for (const id of result.accepted) ctx.out(fill(m.accepted, { id }));
        for (const id of result.rejected) ctx.out(fill(m.rejected, { id }));
        for (const e of result.errors) ctx.err(fill(m.failed, e));
        ctx.out(fill(m.summary, { accepted: result.accepted.length, rejected: result.rejected.length, errors: result.errors.length }));
      }),
    );
}
