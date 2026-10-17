/** Compiled-regex cache keyed on pattern + flags. Vocabulary lists are static, so reuse across
 * calls: a cached regex shared by articles/catalog entries must never be stateful, so only use
 * it for non-global patterns or matchAll (which clones). */
const reCache = new Map<string, RegExp>();

export function getRe(pattern: string, flags: string): RegExp {
  const key = `${pattern}::${flags}`;
  let re = reCache.get(key);
  if (!re) {
    re = new RegExp(pattern, flags);
    reCache.set(key, re);
  }
  return re;
}
