// External deterministic oracle: no Edu imports, no LLM, no network.
const cfg = JSON.parse(process.argv[2]);
const sku = cfg.trim ? cfg.sku.trim() : cfg.sku;
const cache = new Map();
const key = user => cfg.scope === 'user' ? `${user}:${sku}` : sku;
cache.set(key('alice'), 'private-alice');
const observed = cfg.mode === 'isolation' ? cache.get(key('bob')) : sku;
const expected = cfg.mode === 'isolation' ? undefined : 'SKU42';
const ok = observed === expected;
console.log(JSON.stringify({ ok, observed: observed ?? null, expected: expected ?? null, cfg }));
process.exitCode = ok ? 0 : 1;
