/**
 * Dynamic heuristic rules (dynamic_rules table) and their compiled, immutable in-memory form.
 * Pure and browser-safe: the heuristic engine applies a RuleSnapshot synchronously, so extract()
 * never touches the database.
 */
export type RuleKind =
  "add_cue" | "context_filter" | "add_alias" | "add_stopword" | "add_unit_scale";
export type RuleLanguage = "all" | "en" | "sv" | "ru" | "uk";

export interface DynamicRuleRow {
  id: string;
  kind: RuleKind | string;
  language?: string;
  payload: unknown;
}

export interface RuleSnapshot {
  version: number;
  /** Extra stopwords, lower-cased: never reported as a system name. */
  stopwords: ReadonlySet<string>;
  /** Extra aliases per catalog drone id. Aliases to ids not in the catalog are ignored. */
  aliases: ReadonlyMap<string, readonly string[]>;
  /** Active rules of a kind this engine version does not apply yet (cues, filters, scales). */
  unsupported: number;
}

export const emptySnapshot = (): RuleSnapshot => ({
  version: 0,
  stopwords: new Set(),
  aliases: new Map(),
  unsupported: 0,
});

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** Build a snapshot from active rows. Malformed rows are skipped, never thrown on. */
export function compileRuleSnapshot(rows: DynamicRuleRow[], version = 0): RuleSnapshot {
  const stopwords = new Set<string>();
  const aliases = new Map<string, string[]>();
  let unsupported = 0;
  for (const r of rows) {
    const p = obj(r.payload);
    if (r.kind === "add_stopword") {
      const w = str(p["word"]).toLowerCase();
      if (w.length >= 2) stopwords.add(w);
    } else if (r.kind === "add_alias") {
      const id = str(p["droneId"]);
      const alias = str(p["alias"]);
      // Short aliases would match everywhere; the engine's own catalog floor is > 2 chars.
      if (!id || alias.length <= 2) continue;
      const list = aliases.get(id) ?? [];
      if (!list.some((a) => a.toLowerCase() === alias.toLowerCase())) list.push(alias);
      aliases.set(id, list);
    } else unsupported++;
  }
  return { version, stopwords, aliases, unsupported };
}

/** Process-wide active snapshot; the server registry refreshes it, the browser keeps empty. */
let active: RuleSnapshot = emptySnapshot();
export const getActiveRuleSnapshot = () => active;
export const setActiveRuleSnapshot = (s: RuleSnapshot) => {
  active = s;
};
