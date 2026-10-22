import { expect, it } from 'vitest';
import { makeUsage } from './parse.js';
it('does not report missing provider tokens as measured zero', () => {
  const event = makeUsage({ agentId: 'fixture' }, { cost_usd: 0 })[0];
  expect(event).toMatchObject({ type: 'usage', usage: { inputTokens: 0, outputTokens: 0, known: { inputTokens: false, outputTokens: false, costUsd: true } } });
});
it('preserves raw input and normalizes only declared cache semantics', () => {
  const raw = { input_tokens: 20, output_tokens: 0, cache_read_tokens: 3, cache_write_tokens: 2, cost_usd: 0 };
  const exclusive = makeUsage({ agentId: 'claude' }, raw, 'exclusive-cache')[0];
  const inclusive = makeUsage({ agentId: 'codex' }, raw, 'inclusive-cache')[0];
  const ambiguous = makeUsage({ agentId: 'unknown' }, raw, 'unknown')[0];
  expect(exclusive).toMatchObject({ usage: { inputTokens: 25, raw: { inputTokens: 20 }, known: { inputTokens: true, costUsd: true } } });
  expect(inclusive).toMatchObject({ usage: { inputTokens: 20, known: { inputTokens: true } } });
  expect(ambiguous).toMatchObject({ usage: { inputTokens: 20, known: { inputTokens: false } } });
});
