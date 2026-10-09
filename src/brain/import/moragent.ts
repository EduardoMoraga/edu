import { join } from 'node:path';
import type { Brain } from '../brain.js';
import { markdownFiles, importFiles, canonicalKind } from './shared.js';
import type { ImportReport } from './types.js';

export async function importMoragent(sourceRoot: string, brain: Brain): Promise<ImportReport> {
  const root = join(sourceRoot, '.moragent', 'memory');
  const files = [...await markdownFiles(join(root, 'canonical')), ...await markdownFiles(join(root, 'episodic')), ...await markdownFiles(join(root, 'transient'))];
  return importFiles(files, brain, 'import:moragent', path => {
    const relative = path.slice(root.length + 1).split(/[\\/]/);
    if (relative[0] === 'canonical') return { tier: 'canonical', kind: canonicalKind(relative[1]), status: 'proposed' };
    if (relative[0] === 'episodic') return { tier: 'episodic', kind: 'session' };
    return { tier: 'transitive', kind: 'lesson', status: 'candidate' };
  });
}
