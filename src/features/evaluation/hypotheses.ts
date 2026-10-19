import type { Candidate, Drone } from "@/entities/drone/types";
import type { IntelExtractor } from "@/shared/contracts/ai";
import { CUE_TARGETS, type RuleKind, type RuleLanguage } from "@/shared/contracts/rules";
import { normalizeExtraction } from "@/entities/normalization/apply";
import { semanticKeyFor } from "@/entities/normalization/semantic";
import { phoneticKey } from "@/entities/drone/name-key";
import { compareSpecs, comparableSpecs, namesOf, stratifiedSample, type Norm } from "./evaluation";

/**
 * Deterministic rule-hypothesis miner. READ-ONLY, like evaluateHeuristic: it only calls
 * heuristic.extract() and reads candidates/catalog. It proposes; the sandbox decides.
 *
 * Anti-poisoning (EVALUATION_FULL_AUTOMATION §3, pelare 4): the stored extraction is not truth,
 * so a single disagreement never becomes a rule. Every hypothesis needs the same pattern in
 * several independent candidates, and its evidence must sit verbatim in the raw text.
 * differentReading pairs (ranges, qualifiers, decimals) are parser defects for a human, never
 * rules - they are counted, not mined.
 */
export interface RuleHypothesis {
  /** Deterministic from kind + payload, so re-mining the same pattern dedupes. */
  id: string;
  kind: RuleKind;
  language: RuleLanguage;
  payload: Record<string, unknown>;
  targetKey: string;
  rationale: string;
  /** Independent candidates showing the pattern. */
  support: number;
  basis: "structural" | "corroborated";
  samples: { candidateId: string; source: string; evidence: string }[];
}

export interface MineResult {
  hypotheses: RuleHypothesis[];
  /** differentReading pairs seen: routed to a human as parser defects, never to rules. */
  parserDefects: number;
  scanned: number;
}

export interface MineOptions {
  sampleSize?: number;
  seed?: number;
  /** Independent candidates a pattern needs before it is proposed. */
  minSupport?: number;
  maxHypotheses?: number;
}

const TOKEN = /[\p{L}][\p{L}'’-]*/gu;
const tokens = (s: string) => (s.toLowerCase().match(TOKEN) ?? []) as string[];
const fold = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Function words that are never a useful cue or trigger on their own. */
const FILLER = new Set(
  (
    "the of with and for from that this has have its was were are can will about over than " +
    "max maximum min minimum approximately around nearly some more less into like also which " +
    "upto till until reach reaches reaching distance distances " +
    "до від на по при для около порядка більше более менее менше понад свыше " +
    "och med för upp till från cirka"
  ).split(" "),
);
const useful = (t: string) => t.length >= 4 && !FILLER.has(t);

export function languageOf(s: string): RuleLanguage {
  if (/[іїєґ]/iu.test(s)) return "uk";
  if (/[ыэъё]/iu.test(s)) return "ru";
  if (/\p{Script=Cyrillic}/u.test(s)) return "all";
  if (/[åäö]/iu.test(s)) return "sv";
  return /^[a-z' -]+$/i.test(s) ? "en" : "all";
}

/** Stable short id: FNV-1a over the canonical JSON of kind + payload. */
export function hypothesisId(kind: string, payload: Record<string, unknown>): string {
  const s = `${kind}:${JSON.stringify(payload, Object.keys(payload).sort())}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return `hyp-${kind}-${h.toString(36)}`;
}

/** Tokens in the same sentence, up to 24 characters before the claim's number. */
function cueWindow(raw: string, evidence: string): string[] | null {
  const at = raw.indexOf(evidence);
  const digit = evidence.search(/\d/);
  if (at < 0 || digit < 0) return null;
  const n = at + digit;
  const start = Math.max(...[".", "!", "?", ";", "\n"].map((p) => raw.lastIndexOf(p, n - 1))) + 1;
  return tokens(raw.slice(Math.max(start, n - 24), n));
}

/**
 * Context words near a claim but outside its own cue: the last `n` tokens before the number in
 * the same sentence (the context filter's own window), minus the words the evidence itself
 * starts with. Without the subtraction the cue word ("altitude") would be mined as a trigger
 * and suppress every claim of its own key.
 */
function contextTokens(raw: string, evidence: string, n = 4, keepOwn = false): string[] {
  const at = raw.indexOf(evidence);
  const digit = evidence.search(/\d/);
  if (at < 0 || digit < 0) return [];
  const num = at + digit;
  const start = Math.max(...[".", "!", "?", ";", "\n"].map((p) => raw.lastIndexOf(p, num - 1))) + 1;
  const own = new Set(tokens(evidence.slice(0, digit)));
  return tokens(raw.slice(start, num))
    .slice(-n)
    .filter((t) => keepOwn || (!own.has(t) && useful(t)));
}

/** Where a claim sits in raw; a reference evidence the text does not contain is not trusted. */
function verbatim(raw: string, ev: string): string | null {
  if (!ev) return null;
  if (raw.includes(ev)) return ev;
  const f = fold(ev);
  const i = fold(raw).indexOf(f);
  return i < 0 ? null : f;
}

type Bucket = Map<string, { cands: Set<string>; samples: RuleHypothesis["samples"] }>;
const note = (b: Bucket, key: string, c: Candidate, evidence: string) => {
  const e = b.get(key) ?? { cands: new Set<string>(), samples: [] };
  if (!e.cands.has(c.id) && e.samples.length < 3)
    e.samples.push({ candidateId: c.id, source: c.source, evidence: evidence.slice(0, 200) });
  e.cands.add(c.id);
  b.set(key, e);
};

const targetFor = (r: Norm) => CUE_TARGETS.find((t) => semanticKeyFor(t) === r.semantic);

export async function mineHypotheses(
  candidates: readonly Candidate[],
  catalog: Drone[],
  heuristic: IntelExtractor,
  opts: MineOptions = {},
): Promise<MineResult> {
  const minSupport = opts.minSupport ?? 3;
  const eligible = candidates.filter(
    (c) => (c.raw?.trim().length ?? 0) > 50 && c.status !== "discarded",
  );
  const sample = stratifiedSample(eligible, opts.sampleSize ?? 400, opts.seed ?? 1);

  const falseNames: Bucket = new Map(); // name -> candidates where only the heuristic saw it
  const refNames = new Set<string>(); // every name the reference ever reported
  const fpTokens: Bucket = new Map(); // `${key}|${token}` before a false-positive number
  const tpTokens = new Map<string, number>(); // `${key}|${token}` before an agreed number
  const reroutes: Bucket = new Map(); // `${hKey}|${rKey}|${token}` same value, other key
  const missCues: Bucket = new Map(); // `${target}|${token}` before a missed number
  let parserDefects = 0;

  for (const c of sample) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    let heur;
    try {
      heur = normalizeExtraction(await heuristic.extract(c.raw, catalog)).extraction;
    } catch {
      continue;
    }
    for (const n of namesOf(c.extraction)) refNames.add(n);
    const matched = new Set((heur.systems ?? []).filter((s) => s.matchId).map((s) => s.name));
    const ref = new Set(namesOf(c.extraction));
    for (const s of heur.systems ?? []) {
      // Single generic words only: a multi-word or numbered name is a designation, not noise.
      if (matched.has(s.name) || /[\s\d-]/.test(s.name)) continue;
      if (!ref.has(phoneticKey(s.name))) note(falseNames, s.name.toLowerCase(), c, s.name);
    }

    const cmp = compareSpecs(comparableSpecs(heur), comparableSpecs(c.extraction));
    for (const p of cmp.pairs) {
      if (p.type === "differentReading") parserDefects++;
      // Every word near an agreed figure, cue words included: none of them may ever trigger.
      for (const t of new Set([
        ...(cueWindow(c.raw, p.h.evidence) ?? []),
        ...contextTokens(c.raw, p.h.evidence, 4, true),
      ]))
        tpTokens.set(`${p.h.key}|${t}`, (tpTokens.get(`${p.h.key}|${t}`) ?? 0) + 1);
    }
    for (const h of cmp.falsePositives)
      for (const t of new Set(contextTokens(c.raw, h.evidence)))
        note(fpTokens, `${h.key}|${t}`, c, h.evidence);
    for (const w of cmp.wrongKeys) {
      if (!/^[a-z][a-z0-9_]{1,40}$/.test(w.r.key)) continue;
      for (const t of new Set(contextTokens(c.raw, w.h.evidence)))
        note(reroutes, `${w.h.key}|${w.r.key}|${t}`, c, w.h.evidence);
    }
    for (const r of cmp.misses) {
      const target = targetFor(r);
      const ev = target && verbatim(c.raw, r.evidence);
      if (!target || !ev) continue;
      for (const t of new Set((cueWindow(c.raw, ev) ?? []).filter(useful)))
        note(missCues, `${target}|${t}`, c, ev);
    }
  }

  const out: RuleHypothesis[] = [];
  const push = (h: Omit<RuleHypothesis, "id">) =>
    out.push({ id: hypothesisId(h.kind, h.payload), ...h });

  for (const [word, e] of falseNames) {
    if (e.cands.size < minSupport || refNames.has(phoneticKey(word))) continue;
    if (catalog.some((d) => phoneticKey(d.name) === phoneticKey(word))) continue;
    push({
      kind: "add_stopword",
      language: languageOf(word),
      payload: { word },
      targetKey: "system_name",
      rationale: `"${word}" read as a system name in ${e.cands.size} reports; the reference never names it.`,
      support: e.cands.size,
      basis: "structural",
      samples: e.samples,
    });
  }

  // A reroute explains a false positive better than a suppression, so it wins on the same token.
  const rerouted = new Set<string>();
  for (const [k, e] of reroutes) {
    const [hKey, rKey, token] = k.split("|") as [string, string, string];
    if (e.cands.size < minSupport || (tpTokens.get(`${hKey}|${token}`) ?? 0) > 0) continue;
    rerouted.add(`${hKey}|${token}`);
    push({
      kind: "context_filter",
      language: languageOf(token),
      payload: {
        key: hKey,
        triggerWords: [token],
        action: "reroute",
        targetKey: rKey,
        maxTokenDistance: 4,
        position: "before",
      },
      targetKey: hKey,
      rationale: `"${token}" before a ${hKey} figure: ${e.cands.size} reports file the same value as ${rKey}.`,
      support: e.cands.size,
      basis: "corroborated",
      samples: e.samples,
    });
  }
  for (const [k, e] of fpTokens) {
    const [key, token] = k.split("|") as [string, string];
    if (e.cands.size < minSupport || rerouted.has(k) || (tpTokens.get(k) ?? 0) > 0) continue;
    push({
      kind: "context_filter",
      language: languageOf(token),
      payload: {
        key,
        triggerWords: [token],
        action: "suppress",
        maxTokenDistance: 4,
        position: "before",
      },
      targetKey: key,
      rationale: `"${token}" precedes ${e.cands.size} unconfirmed ${key} figures and no confirmed one.`,
      support: e.cands.size,
      basis: "corroborated",
      samples: e.samples,
    });
  }
  for (const [k, e] of missCues) {
    const [target, token] = k.split("|") as [string, string];
    // Two independent sources is the corroboration floor for adding vocabulary.
    if (e.cands.size < Math.max(2, minSupport - 1)) continue;
    push({
      kind: "add_cue",
      language: languageOf(token),
      payload: { target, terms: [token] },
      targetKey: target,
      rationale: `"${token}" precedes ${e.cands.size} ${target} figures the heuristic missed.`,
      support: e.cands.size,
      basis: "corroborated",
      samples: e.samples,
    });
  }

  return {
    hypotheses: out.sort((a, b) => b.support - a.support).slice(0, opts.maxHypotheses ?? 20),
    parserDefects,
    scanned: sample.length,
  };
}
