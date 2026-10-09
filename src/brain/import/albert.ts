import { basename, join, relative as nodeRelative } from 'node:path';
import type { ClaimBand } from '../../core/contracts.js';
import type { Brain } from '../brain.js';
import { markdownFiles, importFiles, asTransitiveKind, canonicalKind } from './shared.js';
import type { ImportReport } from './types.js';

export function albertPathSegments(root: string, file: string, relativePath = nodeRelative): string[] {
  return relativePath(root, file).split(/[\\/]/).filter(Boolean);
}

export async function importAlbert(sourceRoot: string, brain: Brain): Promise<ImportReport> {
  const root = join(sourceRoot, '_ALBERT');
  const files = [
    ...(await markdownFiles(join(root, '1-CANONICO'))),
    ...(await markdownFiles(join(root, '2-EPISODICO'))),
    ...(await markdownFiles(join(root, '3-TRANSITIVO'))),
  ];
  return importFiles(files, brain, 'import:albert', path => {
    const relative = albertPathSegments(root, path);
    if (relative[0] === '1-CANONICO') return { tier: 'canonical', kind: canonicalKind(({ estandares: 'standard', lexico: 'lexicon', negocio: 'domain', personas: 'person' } as Record<string, string>)[relative[1] ?? ''] ?? relative[1]), status: 'proposed' };
    if (relative[0] === '2-EPISODICO') return { tier: 'episodic', kind: 'session' };
    const prefix = /^([DHCAL])-/.exec(relative.at(-1) ?? '')?.[1] ?? 'L';
    return { tier: 'transitive', kind: asTransitiveKind(prefix) };
  }, (meta, body, path) => {
    const rawType = String(meta.tipo ?? '').toLowerCase();
    const status = String(meta.estado ?? '').toLowerCase();
    const confidence: Record<string, ClaimBand> = { alta: 'verified', media: 'inferred', baja: 'hypothesis' };
    const relative = albertPathSegments(root, path);
    const canonical = relative[0] === '1-CANONICO';
    const episodic = relative[0] === '2-EPISODICO';
    const prefix = /^([DHCAL])-/.exec(basename(path))?.[1];
    const kind = rawType || ({ D: 'decision', H: 'hipotesis', C: 'compromiso', A: 'aprendizaje', L: 'aprendizaje' } as Record<string, string>)[prefix ?? ''];
    const statusMap: Record<string, string> = canonical ? { '': 'accepted', aceptada: 'accepted', aceptado: 'accepted' } : kind === 'hipotesis' || kind === 'hypothesis' ? { '': 'open', abierta: 'open', confirmada: 'confirmed', refutada: 'refuted', sin_evidencia: 'no-evidence' } : kind === 'compromiso' || kind === 'commitment' ? { '': 'pending', pendiente: 'pending', entregado: 'delivered', vencido: 'overdue' } : kind === 'decision' ? { '': 'active', vigente: 'active', revertida: 'reverted' } : kind === 'aprendizaje' || kind === 'lesson' ? { '': 'proven', proven: 'proven', permanente: 'proven' } : {};
    const summary = typeof meta.resumen === 'string' ? meta.resumen.trim() : '';
    const noteBody = summary && !body.includes(summary) ? `> ${summary.replaceAll('\n', '\n> ')}\n\n${body}` : undefined;
    const sourceDetail = typeof meta.fuente === 'string' && meta.fuente ? `import:albert · ${meta.fuente}` : 'import:albert';
    const band = typeof meta.banda === 'string' && ['verified', 'inferred', 'hypothesis'].includes(meta.banda) ? meta.banda as ClaimBand : confidence[String(meta.confianza ?? '').toLowerCase()];
    return {
      ...(typeof meta.titulo === 'string' ? { title: meta.titulo } : {}), ...(noteBody ? { body: noteBody } : {}), source: sourceDetail,
      ...(band ? { band } : {}), ...(typeof meta.fecha === 'string' ? { created: meta.fecha } : {}), ...(typeof meta.actualizado === 'string' ? { updated: meta.actualizado } : {}),
      ...(typeof meta.dueño === 'string' ? { owner: meta.dueño } : typeof meta.owner === 'string' ? { owner: meta.owner } : {}),
      ...(typeof meta.plazo === 'string' ? { due: meta.plazo } : typeof meta.due === 'string' ? { due: meta.due } : {}),
      ...(Array.isArray(meta.tags) ? { tags: meta.tags.filter((tag): tag is string => typeof tag === 'string') } : {}),
      status: episodic ? (status === 'borrador' ? 'open-session' : 'closed') : kind === 'aprendizaje' || kind === 'lesson' ? 'proven' : statusMap[status] ?? (canonical ? 'accepted' : undefined), acceptedCanonical: canonical,
    };
  });
}
