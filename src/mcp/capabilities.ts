import { estimateTokens } from '../context/tokens.js';

const sections = ['features', 'limitations', 'commands'] as const;

/** Reduce semantic units, never slice serialized JSON. Version/profile remain host-owned. */
export function boundedCapabilities(raw: string, version: string, toolProfile: 'full' | 'memory', maxTokens = 800): string {
  let supplied: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) supplied = parsed as Record<string, unknown>;
    else supplied = { features: [raw] };
  } catch { supplied = { features: [raw] }; }
  const items = (key: typeof sections[number]) => Array.isArray(supplied[key]) ? (supplied[key] as unknown[]).filter((item): item is string => typeof item === 'string') : [];
  const payload = {
    version, toolProfile, restartRequired: typeof supplied.restartRequired === 'boolean' ? supplied.restartRequired : true,
    features: items('features'), limitations: items('limitations'), commands: items('commands'),
    omitted: { features: 0, limitations: 0, commands: 0 },
  };
  let text = JSON.stringify(payload);
  while (estimateTokens(text) > maxTokens) {
    // Remove the largest trailing item, keeping every retained item intact and ordered.
    const candidates = sections.filter(key => payload[key].length > 0);
    if (!candidates.length) break;
    const key = candidates.reduce((largest, candidate) => estimateTokens(payload[candidate].at(-1)!) > estimateTokens(payload[largest].at(-1)!) ? candidate : largest);
    payload[key].pop();
    payload.omitted[key]++;
    text = JSON.stringify(payload);
  }
  if (estimateTokens(text) <= maxTokens) return text;
  // Keep the hard budget even when it cannot hold identity plus omission counts.
  // {} (or 0 when even {} cannot fit) means insufficient budget, not no capabilities.
  const identity = { version, toolProfile, restartRequired: payload.restartRequired };
  for (const reduced of [{ ...identity, omitted: payload.omitted }, { ...identity, omitted: true }, identity, { version }, {}]) {
    const candidate = JSON.stringify(reduced);
    if (estimateTokens(candidate) <= maxTokens) return candidate;
  }
  return '0'; // The unchanged estimator counts {} as two tokens; JSON 0 fits one.
}
