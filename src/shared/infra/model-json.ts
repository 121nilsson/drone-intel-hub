/**
 * Recover the JSON object a model meant to return.
 *
 * `response_format: json_object` is a request, not a guarantee: reasoning models wrap the answer
 * in `<think>` blocks, others fence it in ```json, and some double-encode it as a JSON string.
 * Shared by the transport (which uses it to decide whether a provider answered at all, so a
 * non-JSON reply falls through to the next provider) and the extractor (which parses the result).
 *
 * Returns undefined when no JSON object can be recovered.
 */
export function parseModelJson(content: string): Record<string, unknown> | undefined {
  const text = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  if (!text) return undefined;
  const attempt = (s: string): Record<string, unknown> | undefined => {
    try {
      let v: unknown = JSON.parse(s);
      // Double-encoded: the object arrived as a JSON string.
      if (typeof v === "string") v = JSON.parse(v);
      return v && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  };
  const direct = attempt(text);
  if (direct) return direct;
  // Prose around the object ("Here is the JSON: {...}"). Outermost braces only.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? attempt(text.slice(start, end + 1)) : undefined;
}
