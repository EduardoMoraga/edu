import { describe, expect, it } from 'vitest';
import { removeManagedBlock, upsertManagedBlock } from './blocks.js';

describe('managed blocks', () => {
  it('preserves surrounding bytes and is idempotent', () => {
    const original = '# User\n\nKeep this.\n';
    const once = upsertManagedBlock(original, 'Edu protocol');
    expect(upsertManagedBlock(once, 'Edu protocol')).toBe(once);
    expect(removeManagedBlock(once)).toBe(original);
    expect(removeManagedBlock(upsertManagedBlock('No trailing newline', 'Edu protocol'))).toBe('No trailing newline');
  });

  it('rejects malformed and duplicate markers rather than guessing', () => {
    expect(() => upsertManagedBlock('<!-- edu:core:start -->', 'x')).toThrow();
    expect(() => removeManagedBlock('<!-- edu:core:end -->')).toThrow();
  });
});
