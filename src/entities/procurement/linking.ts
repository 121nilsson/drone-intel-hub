import type { Procurement } from "./types";

/**
 * Which systems a deal is about. A post about a contract often names a dozen systems - the ones
 * the buyer already fields, the competitor that lost, the programme's history - and linking all
 * of them to the deal made one contract show up on ten dossiers. The sentence that states the
 * figure is the claim's own evidence, so the systems it names are the ones the deal is about.
 */
export interface SystemRef {
  name: string;
  id?: string;
  aliases?: readonly string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `name` as a whole word in `text`: "Tyr" is not in "Tyrant", "Akash" is in "Akash-NG". */
export function mentions(text: string, name: string): boolean {
  const n = name.trim();
  // Two letters match too much prose ("Ka", "FP") to say a sentence names a system.
  if (n.length < 3) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(n)}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

export function namedIn(text: string, systems: readonly SystemRef[]): SystemRef[] {
  return systems.filter((s) => [s.name, ...(s.aliases ?? [])].some((n) => mentions(text, n)));
}

/**
 * A stored record narrowed to the systems its own text names. Ids and names are narrowed apart
 * (they were collected separately and do not line up), and only where the text names at least
 * one of them: a record whose sentence names nothing keeps its links, since there is no better
 * evidence to replace them with. Undefined when nothing changes.
 */
export function narrowLinks(
  p: Procurement,
  systemFor: (id: string) => SystemRef | undefined,
): Procurement | undefined {
  const text = p.notes ?? "";
  const ids = p.systemIds ?? [];
  const names = p.systemNames ?? [];
  const keptIds = ids.filter((id) => {
    const ref = systemFor(id);
    return ref ? namedIn(text, [ref]).length > 0 : false;
  });
  const keptNames = names.filter((n) => mentions(text, n));
  const nextIds = keptIds.length ? keptIds : ids;
  const nextNames = keptNames.length ? keptNames : names;
  if (nextIds.length === ids.length && nextNames.length === names.length) return undefined;
  const product = p.product === names.join(", ") ? nextNames.join(", ") : p.product;
  return {
    ...p,
    ...(nextIds.length ? { systemIds: nextIds } : {}),
    ...(nextNames.length ? { systemNames: nextNames } : {}),
    ...(product ? { product } : {}),
  };
}
