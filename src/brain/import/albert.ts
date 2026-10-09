import { join } from 'node:path';
import type { Brain } from '../brain.js';
import { markdownFiles, importFiles, asTransitiveKind, canonicalKind } from './shared.js';
import type { ImportReport } from './types.js';

export async function importAlbert(sourceRoot: string, brain: Brain): Promise<ImportReport> {
  const root = join(sourceRoot, '_ALBERT');
  const files = [
    ...(await markdownFiles(join(root, '1-CANONICO'))),
    ...(await markdownFiles(join(root, '2-EPISODICO'))),
    ...(await markdownFiles(join(root, '3-TRANSITIVO'))),
  ];
  return importFiles(files, brain, 'import:albert', path => {
    const relative = path.slice(root.length + 1).split(/[\\/]/);
    if (relative[0] === '1-CANONICO') return { tier: 'canonical', kind: canonicalKind(relative[1]), status: 'proposed' };
    if (relative[0] === '2-EPISODICO') return { tier: 'episodic', kind: 'session' };
    const prefix = /^([DHCAL])-/.exec(relative.at(-1) ?? '')?.[1] ?? 'L';
    return { tier: 'transitive', kind: asTransitiveKind(prefix) };
  });
}
