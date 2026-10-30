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

/**
 * Where digests meet small models, the notation repeats: a model that was shown the evidence
 * digest copies its machine references back as "(specifications.wingspan.claims[0].value)",
 * "system.id", or provenance lines that are nothing but paths. Paths are notation, not
 * statements an analyst can read, so the brief boundary scrubs them.
 *
 * Parenthesised references come off in place; lines that are purely paths (or the
 * "System record:" restatement of the entry's own identity) are dropped. Ordinary sentences -
 * including ones that merely name a range or a system - pass through untouched.
 */

/** A parenthetical whose contents are digest references rather than prose. */
const POINTER_PARENS =
  /\s*\([^()]*?\b(?:specifications\.[\w.[\]]+|system\.[\w.[\]]+|claims\[\d+\](?:\.\w+)*|\.value\b|\.source\b|\.label\b|\.key\b)\b[^()]*?\)/g;

/** A path-shaped reference anywhere in a line: "system.id", "specifications.range…". */
const DOTTED_FIELD = /\b(?:system|specifications)\.[a-z]/;
const INDEXED_PATH = /\b(?:claims|specifications)\[\d/;

/** The entry's identifying restatement an excerpt lists as its first "fact". */
const RECORD_INTRO = /^(?:catalog |system )?record\s*[:-]/i;

export function stripPointerNotation(text: string): string {
  return text
    .replace(POINTER_PARENS, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * A brief list item an analyst reads - or undefined when the line was notation: a pure path, a
 * pointer parenthetical that stripped to nothing, or the record restatement.
 */
export function humanizeBriefItem(text: string): string | undefined {
  const stripped = stripPointerNotation(text);
  if (!stripped) return undefined;
  if (RECORD_INTRO.test(stripped)) return undefined;
  if (DOTTED_FIELD.test(stripped) || INDEXED_PATH.test(stripped)) return undefined;
  return stripped;
}
