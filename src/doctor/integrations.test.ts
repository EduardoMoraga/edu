import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { integrationPreflight } from './integrations.js';

describe('optional integration preflight', () => {
  it('reports missing/invalid configuration without executing or installing packages', async () => {
    const home = await mkdtemp(join(tmpdir(), 'edu3-integrations-'));
    try {
      const missing = await integrationPreflight(home);
      expect(missing.configuration).toBe('missing');
      expect(missing.integrations).toHaveLength(6);
      expect(missing.integrations.every(i => !i.defaultEnabled && !i.registered && i.authentication === 'unknown')).toBe(true);
      const dir = join(home, '.pi', 'agent');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'settings.json'), '{broken');
      expect((await integrationPreflight(home)).configuration).toBe('invalid');
      await writeFile(join(dir, 'settings.json'), JSON.stringify({ packages: ['npm:context-mode@1.0', { source: 'npm:pi-goal-x@2' }, 'npm:not-openwiki'] }));
      const report = await integrationPreflight(home);
      expect(report.integrations.find(i => i.id === 'context-mode')).toMatchObject({ registered: true, license: 'ELv2', state: 'external-only', runtimeCompatibility: 'unverified' });
      expect(report.integrations.find(i => i.id === 'pi-goal-x')?.registered).toBe(true);
      expect(report.integrations.find(i => i.id === 'openwiki')?.registered).toBe(false);
      expect(report.piToolDiscovery).toContain('codemode');
    } finally { await rm(home, { recursive: true, force: true }); }
  });
});
