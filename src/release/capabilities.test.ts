import { describe, expect, it } from 'vitest';
import { packageVersion } from '../cli/package.js';
import { getCapabilities } from './capabilities.js';
describe('binary capabilities', () => {
  it('reports the actual package version and a serializable honest contract', () => {
    const result = getCapabilities();
    expect(result.version).toBe(packageVersion());
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(result.commands).toContain('edu brain recall');
    expect(result.limitations).toContain('Persistent memory is not model-weight training or proof of reduced human work.');
    expect(result.restartRequired).toBe(true);
  });
  it('allows a caller-supplied version without asserting future capabilities', () => {
    expect(getCapabilities('2.0.0-rc.1').version).toBe('2.0.0-rc.1');
    expect(getCapabilities('2.0.0-rc.1').features).toEqual(getCapabilities().features);
  });
});
