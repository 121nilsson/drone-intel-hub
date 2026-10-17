/**
 * OpenAI-compatible feeds and feed HTML occasionally transport emoji or CJK text as a lone
 * UTF-16 surrogate half (for example "\ud83c" without its low half, "\udff3"...). That string
 * is legal as a JavaScript string and will be accepted by `JSON.stringify`, but PostgreSQL
 * rejects it as invalid UTF-8 JSON (`Unicode low surrogate must follow a high surrogate`),
 * which aborts the whole `put()` and surfaces as a database error in the logs.
 *
 * We normalize the bad half to the replacement character rather than deleting it. Deleting
 * entire graphemes would silently throw away source text, and a plain delete can fuse two
 * unrelated characters. This is a transport normalisation, not an interpretation decision,
 * so it is safe to apply in both the browser and server paths.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export const sanitizeText = (value: string): string => value.replace(LONE_SURROGATE, "\uFFFD");

export const sanitizeJson = <T>(value: T): T => {
  if (typeof value === "string") return sanitizeText(value) as T;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeJson(item)) as unknown as T;
  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    result[sanitizeText(key)] = sanitizeJson(inner);
  }
  return result as T;
};
