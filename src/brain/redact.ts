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
const KEY_WORDS = String.raw`(?:password|passwd|passphrase|pass|pwd|client[_-]?secret|secret[_ -]?access[_ -]?key|secret|api[_ -]?key|access[_ -]?key(?:[_-]?id)?|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|private[_-]?key|credentials?|conn(?:ection)?[_ -]?str(?:ing)?|auth)`;

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
    // An Authorization header with a scheme: whatever follows is a credential, whatever its character mix.
    kind: 'bearer-token',
    pattern: /\b((?:proxy-)?authorization["']?\s*[:=]\s*["']?(?:bearer|basic|token)\s+)([^\s"'`,;]{8,})/gi,
    replace: (m, prefix, value) => (isPlaceholder(value!) ? `${prefix}${value}` : `${prefix}${m}`),
  },
  {
    // A bare `Bearer <token>` / `Basic <base64>`; a plain (capitalized) word after it is prose, not a credential.
    kind: 'bearer-token',
    pattern: /\b(bearer|basic)\s+([A-Za-z0-9\-._~+/]{8,}=*)/gi,
    replace: (m, scheme, value) => (/^[A-Z]?[a-z]+$/.test(value!) || (scheme!.toLowerCase() === 'bearer' && value!.length < 12) ? `${scheme} ${value}` : `${scheme} ${m}`),
  },
  {
    kind: 'connection-string',
    pattern: /\b([a-z][a-z0-9+.-]{1,20}:\/\/)([^\s:@/]+):([^\s@/]+)@/gi,
    replace: (m, scheme, user, password) => (isPlaceholder(password!) ? `${scheme}${user}:${password}@` : `${scheme}${user}:${m}@`),
  },
  {
    // key = value, key: value, "key": "value", KEY=value (env files). Only the value is replaced: a quoted value
    // whole (spaces included), an unquoted one to the end of its token.
    kind: 'assignment',
    pattern: new RegExp(String.raw`(\b(?:[\w.-]*[_.-])?${KEY_WORDS}["']?\s*[:=][ \t]*)(?:"([^"\n]+)"|'([^'\n]+)'|([^\s"'\`,;)}\]]{4,}))`, 'gi'),
    replace: (m, prefix, double, single, bare) => {
      const quote = double ? '"' : single ? "'" : '';
      const value = double || single || bare!;
      return `${prefix}${quote}${isPlaceholder(value) ? value : m}${quote}`;
    },
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

/**
 * `redactSecrets` over every string in a JSON-like value (arrays and plain objects, recursively; keys kept).
 * Used for free-text metadata (tags, source, owner, provenance records…) at the same write boundary as bodies.
 */
export function redactValue<T>(value: T): { value: T; kinds: string[] } {
  const kinds: string[] = [];
  const walk = (item: unknown): unknown => {
    if (typeof item === 'string') {
      const result = redactSecrets(item);
      for (const kind of result.kinds) if (!kinds.includes(kind)) kinds.push(kind);
      return result.text;
    }
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, walk(child)]));
    }
    return item;
  };
  const out = walk(value) as T;
  return { value: kinds.length ? out : value, kinds };
}

/** Tag Edu adds to a note whose title, body or free-text metadata had secrets redacted. */
export const REDACTED_TAG = 'redacted';
