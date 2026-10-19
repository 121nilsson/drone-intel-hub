/**
 * Dynamic heuristic rules (dynamic_rules table) and their compiled, immutable in-memory form.
 * Pure and browser-safe: the heuristic engine applies a RuleSnapshot synchronously, so extract()
 * never touches the database.
 *
 * The DSL never carries a regex: every term is a literal that the compiler escapes, and a stem
 * only gets a bounded letter suffix. Generated rules therefore cannot cause catastrophic
 * backtracking or match outside the words they name.
 */
export type RuleKind =
  "add_cue" | "context_filter" | "add_alias" | "add_stopword" | "add_unit_scale";
export type RuleLanguage = "all" | "en" | "sv" | "ru" | "uk";
export const RULE_LANGUAGES: readonly RuleLanguage[] = ["all", "en", "sv", "ru", "uk"];

/**
 * Spec keys a dynamic cue may feed. Each one has a fixed unit set and cross-class guard in the
 * engine (heuristics/extractors/dynamic.ts), so a rule adds vocabulary, never new semantics.
 */
export const CUE_TARGETS = [
  "range",
  "speed",
  "endurance",
  "altitude",
  "wingspan",
  "payload",
  "warhead",
  "weight_mtow",
  "length",
  "engagement_range",
  "detection_range",
  "target_altitude_max",
] as const;
export type CueTarget = (typeof CUE_TARGETS)[number];

export interface DynamicRuleRow {
  id: string;
  kind: RuleKind | string;
  language?: string;
  payload: unknown;
}

export interface CompiledCue {
  id: string;
  target: CueTarget;
  /** Escaped alternation of the rule's terms (and bounded stem), no capture groups. */
  pattern: string;
}

export interface CompiledFilter {
  id: string;
  /** Spec key the filter watches, e.g. "altitude". */
  key: string;
  /** Lower-cased literal trigger words. */
  triggers: readonly string[];
  action: "suppress" | "reroute";
  /** Spec key a rerouted claim moves to, e.g. "target_altitude_max". */
  targetKey?: string;
  /** Trigger must sit within this many tokens of the number, inside the same sentence. */
  maxTokenDistance: number;
  /** "before": only tokens left of the number; "anywhere_in_scope": either side. */
  position: "before" | "anywhere_in_scope";
}

export interface RuleSnapshot {
  version: number;
  /** Extra stopwords, lower-cased: never reported as a system name. */
  stopwords: ReadonlySet<string>;
  /** Extra aliases per catalog drone id. Aliases to ids not in the catalog are ignored. */
  aliases: ReadonlyMap<string, readonly string[]>;
  /** Extra cue vocabulary for existing spec extractors. */
  cues: readonly CompiledCue[];
  /** Post-extraction guards against cross-class contamination. */
  filters: readonly CompiledFilter[];
  /** Active rules of a kind this engine version does not apply yet (unit scales). */
  unsupported: number;
  /** Rows dropped as malformed, by id, so the UI can say why a rule had no effect. */
  invalid: readonly string[];
}

export const emptySnapshot = (): RuleSnapshot => ({
  version: 0,
  stopwords: new Set(),
  aliases: new Map(),
  cues: [],
  filters: [],
  unsupported: 0,
  invalid: [],
});

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MAX_TERMS = 12;
/** Literal terms: letters, digits, spaces, hyphen, apostrophe. Anything else is rejected. */
const TERM = /^[\p{L}\p{N}][\p{L}\p{N} '’-]{1,59}$/u;

function terms(p: Record<string, unknown>, field: string): string[] | null {
  const raw = p[field];
  const list = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).map(str);
  if (!list.length || list.length > MAX_TERMS || !list.every((t) => TERM.test(t))) return null;
  return [...new Set(list.map((t) => t.toLowerCase()))];
}

function compileCue(id: string, p: Record<string, unknown>): CompiledCue | null {
  const target = str(p["target"] ?? p["semanticKey"]) as CueTarget;
  if (!CUE_TARGETS.includes(target)) return null;
  const literal = p["terms"] === undefined ? [] : terms(p, "terms");
  if (literal === null) return null;
  const stem = str(p["stem"]).toLowerCase();
  // A stem shorter than 4 letters would match half the dictionary.
  if (stem && !/^\p{L}{4,20}$/u.test(stem)) return null;
  const parts = [
    ...literal.map((t) => esc(t).replace(/ +/g, "\\s+")),
    ...(stem ? [`${esc(stem)}\\p{L}{0,6}`] : []),
  ];
  if (!parts.length) return null;
  return { id, target, pattern: `(?:${parts.join("|")})` };
}

function compileFilter(id: string, p: Record<string, unknown>): CompiledFilter | null {
  const key = str(p["key"] ?? p["semanticKey"]);
  const triggers = terms(p, "triggerWords");
  const action = str(p["action"]) === "reroute" ? "reroute" : "suppress";
  const targetKey = str(p["targetKey"]);
  const distance = Number(p["maxTokenDistance"] ?? 4);
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(key) || !triggers) return null;
  if (action === "reroute" && (!/^[a-z][a-z0-9_]{1,40}$/.test(targetKey) || targetKey === key))
    return null;
  if (!Number.isInteger(distance) || distance < 1 || distance > 8) return null;
  const position = str(p["position"]) === "anywhere_in_scope" ? "anywhere_in_scope" : "before";
  return {
    id,
    key,
    triggers,
    action,
    ...(action === "reroute" ? { targetKey } : {}),
    maxTokenDistance: distance,
    position,
  };
}

/** Build a snapshot from active rows. Malformed rows are skipped, never thrown on. */
export function compileRuleSnapshot(rows: DynamicRuleRow[], version = 0): RuleSnapshot {
  const stopwords = new Set<string>();
  const aliases = new Map<string, string[]>();
  const cues: CompiledCue[] = [];
  const filters: CompiledFilter[] = [];
  const invalid: string[] = [];
  let unsupported = 0;
  for (const r of rows) {
    const p = obj(r.payload);
    if (r.language && !RULE_LANGUAGES.includes(r.language as RuleLanguage)) {
      invalid.push(r.id);
      continue;
    }
    if (r.kind === "add_stopword") {
      const words = p["word"] !== undefined ? terms(p, "word") : terms(p, "terms");
      const ok = words?.filter((w) => w.length >= 2) ?? [];
      if (!ok.length) invalid.push(r.id);
      for (const w of ok) stopwords.add(w);
    } else if (r.kind === "add_alias") {
      const id = str(p["droneId"] ?? p["targetDroneId"]);
      const alias = str(p["alias"]);
      // Short aliases would match everywhere; the engine's own catalog floor is > 2 chars.
      if (!id || alias.length <= 2) {
        invalid.push(r.id);
        continue;
      }
      const list = aliases.get(id) ?? [];
      if (!list.some((a) => a.toLowerCase() === alias.toLowerCase())) list.push(alias);
      aliases.set(id, list);
    } else if (r.kind === "add_cue") {
      const c = compileCue(r.id, p);
      if (c) cues.push(c);
      else invalid.push(r.id);
    } else if (r.kind === "context_filter") {
      const f = compileFilter(r.id, p);
      if (f) filters.push(f);
      else invalid.push(r.id);
    } else unsupported++;
  }
  return { version, stopwords, aliases, cues, filters, unsupported, invalid };
}

/** Lower-cased literal words a rule matches on; the sandbox uses them to find affected texts. */
export function ruleTerms(row: DynamicRuleRow): string[] {
  const p = obj(row.payload);
  const out = [
    ...(row.kind === "add_alias" ? [str(p["alias"])] : []),
    ...(row.kind === "add_stopword" ? [str(p["word"])] : []),
    ...(Array.isArray(p["terms"]) ? p["terms"].map(str) : []),
    ...(Array.isArray(p["triggerWords"]) ? p["triggerWords"].map(str) : []),
    ...(row.kind === "add_cue" ? [str(p["stem"])] : []),
  ];
  return [...new Set(out.filter((t) => t.length >= 2).map((t) => t.toLowerCase()))];
}

/** Process-wide active snapshot; the server registry refreshes it, the browser keeps empty. */
let active: RuleSnapshot = emptySnapshot();
export const getActiveRuleSnapshot = () => active;
export const setActiveRuleSnapshot = (s: RuleSnapshot) => {
  active = s;
};
