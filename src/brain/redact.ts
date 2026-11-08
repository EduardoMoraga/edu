/**
 * Secret redaction applied to note titles and bodies before anything is persisted. A brain is plain Markdown
 * that gets synced and shared between machines and agents, so a pasted credential must never land in it.
 *
 * Each match is replaced by `[REDACTED:<kind>]`. For assignments and connection strings only the secret part
 * is replaced, so the note still says which key or user was involved. Patterns are deliberately conservative
 * about prose: a `password` word alone is not a secret, `password=<value>` is.
 */

export interface RedactionResult {
  text: string;
  /** Kinds redacted, deduplicated, in first-seen order (e.g. `['github-token', 'assignment']`). */
  kinds: string[];
}

interface Rule {
  kind: string;
  pattern: RegExp;
  /** Builds the replacement; defaults to the whole match. */
  replace?: (marker: string, ...groups: string[]) => string;
}

const marker = (kind: string) => `[REDACTED:${kind}]`;
const KEY_WORDS = String.raw`(?:password|passwd|pwd|passphrase|secret|client[_-]?secret|api[_ -]?key|access[_ -]?key(?:[_-]?id)?|secret[_ -]?access[_ -]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|private[_-]?key|credentials?)`;

const RULES: Rule[] = [
  { kind: 'private-key', pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
  { kind: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai-key', pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g },
  { kind: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})/g },
  { kind: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { kind: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    kind: 'bearer-token',
    pattern: /\b(Bearer|bearer|BEARER|Basic)\s+([A-Za-z0-9\-._~+/]{16,}=*)/g,
    replace: (m, scheme, value) => (/[\d\-._~+/=]/.test(value!) ? `${scheme} ${m}` : `${scheme} ${value}`),
  },
  {
    kind: 'connection-string',
    pattern: /\b([a-z][a-z0-9+.-]{1,20}:\/\/)([^\s:@/]+):([^\s@/]+)@/gi,
    replace: (m, scheme, user, password) => (isPlaceholder(password!) ? `${scheme}${user}:${password}@` : `${scheme}${user}:${m}@`),
  },
  {
    // key = value, key: value, "key": "value", KEY=value (env files). Only the value is replaced.
    kind: 'assignment',
    pattern: new RegExp(String.raw`(\b(?:[\w.-]*[_.-])?${KEY_WORDS}["']?\s*[:=]\s*)(["']?)([^\s"'\`,;)}\]]{4,})\2`, 'gi'),
    replace: (m, prefix, quote, value) => (isPlaceholder(value!) ? `${prefix}${quote}${value}${quote}` : `${prefix}${quote}${m}${quote}`),
  },
  {
    // "the api key is 9f8a…" / "token 9f8a…": a long, high-entropy run right after a key-like word.
    kind: 'high-entropy',
    pattern: new RegExp(String.raw`(\b${KEY_WORDS}\s+(?:is\s+|was\s+|of\s+)?)([A-Za-z0-9_\-+/=]{32,})`, 'gi'),
    replace: (m, prefix, value) => (looksRandom(value!) ? `${prefix}${m}` : `${prefix}${value}`),
  },
];

/** Values that are clearly not secrets: earlier redactions, templates, env lookups, masks, booleans. */
function isPlaceholder(value: string): boolean {
  return /^\[REDACTED/.test(value) || /^(?:<.*>|\$\{?.*|\{\{.*|%\w+%?|\*+|x+|\.{3,}|…|null|none|true|false|undefined|changeme|example|redacted|your[-_].*|process\.env\..*|os\.environ.*|env\..*)$/i.test(value);
}

/** Shannon entropy per character with at least letters and digits mixed: random tokens, not words or paths. */
function looksRandom(value: string): boolean {
  if (!/[a-z]/i.test(value) || !/\d/.test(value)) return false;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const n of counts.values()) { const p = n / value.length; entropy -= p * Math.log2(p); }
  return entropy >= 3.5;
}

/** Redacts known secret shapes from `text`. Idempotent: redacting a redacted text changes nothing. */
export function redactSecrets(text: string): RedactionResult {
  const kinds: string[] = [];
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      const groups = rest.slice(0, -2).map(group => (typeof group === 'string' ? group : ''));
      const replaced = rule.replace ? rule.replace(marker(rule.kind), ...groups) : marker(rule.kind);
      if (replaced !== match && !kinds.includes(rule.kind)) kinds.push(rule.kind);
      return replaced;
    });
  }
  return { text: out, kinds };
}

/** Tag Edu adds to a note whose title or body had secrets redacted. */
export const REDACTED_TAG = 'redacted';
