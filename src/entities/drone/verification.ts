import { catalogNames } from "./catalog-names";
import { ANALYST_SOURCE, claimCounts, correctedPoint } from "./claim-review";
import { PLAUSIBLE } from "./auto-correction";
import { rawPoint } from "./consensus";
import { mentionsName } from "./name-key";
import { attributeSemantic } from "./spec-engine";
import type {
  ClaimVerification,
  Drone,
  SpecAttribute,
  SpecClaim,
  VerificationCheck,
  VerificationKind,
  VerificationVerdict,
} from "./types";
import { canonicalUnitForSemantic } from "@/entities/normalization/semantic";
import { canonicalUnitFor, convert, normalizeQuantityLoose } from "@/entities/normalization/units";
import { outletKey } from "@/entities/source/outlet-record";

/**
 * Deterministic claim verification (Phase 1 of the autonomy plan).
 *
 * The verifier answers four questions that need no model: is the quoted evidence in the source,
 * is the figure measured in the unit the attribute uses, is it physically plausible, and does the
 * sentence name the system it was filed under. A claim that fails one of these is *rejected*
 * because the source or the arithmetic contradicts it. A claim whose checks cannot run, or whose
 * evidence does not name the system, is *uncertain* - stored and shown, never silently trusted.
 *
 * It never edits a claim's value, never removes a claim and never calls AI. Phase 1 keeps every
 * existing human gate; this only records what the machine can already prove.
 */

/**
 * Bumping this re-verifies the whole catalogue on the next backfill. 2: identity anchored to the
 * evidence sentence with the extractor's strict matcher; sources counted per outlet. 3: claims
 * written without a post id are linked back to their post, and a missing post says why. 4: the
 * run moved to the server, which reads the whole archive; version 3 verdicts were written by the
 * browser over its newest 3,000 posts and called older posts "not in the archive".
 */
export const VERIFIER_VERSION = "deterministic-4";

export type ClaimTextResolver = (claim: SpecClaim) => string | undefined;

const fold = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** A name distinctive enough to contradict this claim when it, and not the drone, is named. */
const distinctive = (name: string) => name.trim().length >= 4 || /\d/.test(name);

const inBounds = (value: number, bounds: { min: number; max: number }) =>
  value >= bounds.min && value <= bounds.max;

interface CheckInput {
  kind: VerificationKind;
  verdict: VerificationVerdict;
  applicable: boolean;
  detail?: string;
  confidence?: number;
  evidence?: string;
  sourceId?: string;
  at: string;
}

const check = ({
  kind,
  verdict,
  applicable,
  detail,
  confidence,
  evidence,
  sourceId,
  at,
}: CheckInput): VerificationCheck => ({
  id: kind,
  kind,
  verdict,
  applicable,
  ...(confidence !== undefined ? { confidence } : {}),
  ...(detail ? { detail } : {}),
  ...(evidence ? { evidence: evidence.slice(0, 500) } : {}),
  ...(sourceId ? { sourceId } : {}),
  verifierVersion: VERIFIER_VERSION,
  at,
});

/** The unit an attribute is measured in, as the catalogue normalizes it. */
function expectedUnit(spec: SpecAttribute): string | undefined {
  const semantic = attributeSemantic(spec);
  return (
    canonicalUnitForSemantic(semantic) ??
    spec.canonicalUnit ??
    (spec.unit ? canonicalUnitFor(spec.unit) : undefined)
  );
}

/** The claim's own reading, parsed from `normalized`, `raw` or the stored value plus spec unit. */
function reading(claim: SpecClaim, spec: SpecAttribute) {
  if (claim.normalized) return claim.normalized;
  if (claim.raw) {
    const parsed = normalizeQuantityLoose(claim.raw);
    if (parsed) return parsed;
  }
  if (typeof claim.value === "number" && spec.unit)
    return normalizeQuantityLoose(`${claim.value} ${spec.unit}`);
  return normalizeQuantityLoose(String(claim.value));
}

function evidenceCheck(claim: SpecClaim, text: string | undefined, at: string): VerificationCheck {
  const proof = claim.evidence?.trim() || claim.raw?.trim();
  if (!proof)
    return check({
      kind: "evidence_span",
      verdict: "uncertain",
      applicable: true,
      confidence: 0.2,
      detail: "no quoted evidence to locate",
      at,
    });
  if (!text)
    return check({
      kind: "evidence_span",
      verdict: "uncertain",
      applicable: true,
      confidence: 0.2,
      // Three different gaps, told apart so the exception list points at the right fix: a post
      // pruned from the archive, a reference page that was never a post, and a claim written
      // without a link to the post it came from.
      detail: claim.sourceId
        ? "source post is not in the archive"
        : claim.extractionEngine === "reference"
          ? "reference import: there is no post to check against"
          : "the claim records no source post",
      evidence: proof,
      ...(claim.sourceId ? { sourceId: claim.sourceId } : {}),
      at,
    });
  const found = fold(text).includes(fold(proof));
  return check({
    kind: "evidence_span",
    verdict: found ? "pass" : "fail",
    applicable: true,
    confidence: 1,
    detail: found
      ? "quoted evidence occurs in the source post"
      : "quoted evidence does not occur in the source post",
    evidence: proof,
    ...(claim.sourceId ? { sourceId: claim.sourceId } : {}),
    at,
  });
}

function unitCheck(spec: SpecAttribute, claim: SpecClaim, at: string): VerificationCheck {
  const expected = expectedUnit(spec);
  const parsed = reading(claim, spec);
  if (!expected)
    return check({
      kind: "unit_dimension",
      verdict: "uncertain",
      applicable: false,
      detail: "attribute has no canonical measurement unit",
      at,
    });
  if (!parsed?.canonicalUnit) {
    const numeric = typeof claim.value === "number" || Number.isFinite(Number(claim.raw));
    return check({
      kind: "unit_dimension",
      verdict: "uncertain",
      applicable: numeric,
      confidence: 0.3,
      detail: numeric ? "value has no unit to check" : "value is not a measurement",
      at,
    });
  }
  if (parsed.canonicalUnit !== expected)
    return check({
      kind: "unit_dimension",
      verdict: "fail",
      applicable: true,
      confidence: 1,
      detail: `read as ${parsed.canonicalUnit}, but the attribute is measured in ${expected}`,
      at,
    });
  return check({
    kind: "unit_dimension",
    verdict: "pass",
    applicable: true,
    confidence: 1,
    detail: `measured in ${expected}`,
    at,
  });
}

/** Point or range readings in the bounds' unit, or undefined when there is nothing to bound. */
function boundValues(spec: SpecAttribute, claim: SpecClaim, unit: string): number[] | undefined {
  const fixed = correctedPoint(claim);
  const point = fixed ?? rawPoint(spec, claim);
  if (point) {
    if (!point.unit || point.unit === unit) return [point.value];
    const converted = convert(point.value, point.unit, unit);
    return converted === undefined ? undefined : [converted];
  }
  const range = claim.normalized?.range;
  const from = claim.normalized?.canonicalUnit;
  if (!range || !from) return undefined;
  const values = [range.min, range.max].flatMap((v) => {
    if (v === undefined) return [];
    const converted = from === unit ? v : convert(v, from, unit);
    return converted === undefined ? [] : [converted];
  });
  return values.length ? values : undefined;
}

function boundsCheck(spec: SpecAttribute, claim: SpecClaim, at: string): VerificationCheck {
  const semantic = attributeSemantic(spec);
  const bounds = PLAUSIBLE[semantic];
  if (!bounds)
    return check({
      kind: "bounds",
      verdict: "uncertain",
      applicable: false,
      detail: "no plausibility bounds for this attribute",
      at,
    });
  const unit = expectedUnit(spec);
  if (unit && unit !== bounds.unit)
    return check({
      kind: "bounds",
      verdict: "uncertain",
      applicable: false,
      detail: `bounds are stated in ${bounds.unit}, attribute in ${unit}`,
      at,
    });
  const values = boundValues(spec, claim, bounds.unit);
  if (!values)
    return check({
      kind: "bounds",
      verdict: "uncertain",
      applicable: false,
      detail: "no point or range reading to bound",
      at,
    });
  const outside = values.filter((v) => !inBounds(v, bounds));
  if (!outside.length)
    return check({
      kind: "bounds",
      verdict: "pass",
      applicable: true,
      confidence: 0.9,
      detail: `within ${bounds.min}–${bounds.max} ${bounds.unit}`,
      at,
    });

  const fix = claim.autoCorrection;
  if (fix?.kind === "unit" && fix.applied)
    return check({
      kind: "bounds",
      verdict: "pass",
      applicable: true,
      confidence: 0.9,
      detail: `unit slip corrected to ${fix.value} ${fix.unit ?? bounds.unit}`,
      at,
    });
  if (fix?.kind === "unit" && fix.value !== undefined && inBounds(fix.value, bounds))
    return check({
      kind: "bounds",
      verdict: "uncertain",
      applicable: true,
      confidence: 0.4,
      detail: `outside ${bounds.min}–${bounds.max} ${bounds.unit}; a unit correction to ${fix.value} ${fix.unit ?? bounds.unit} is proposed`,
      at,
    });
  if (fix?.kind === "implausible")
    return check({
      kind: "bounds",
      verdict: "fail",
      applicable: true,
      confidence: 1,
      detail: `outside what the catalogue accepts for ${semantic} (${bounds.min}–${bounds.max} ${bounds.unit})`,
      at,
    });
  return check({
    kind: "bounds",
    verdict: "fail",
    applicable: true,
    confidence: 1,
    detail: `outside what the catalogue accepts for ${semantic} (${bounds.min}–${bounds.max} ${bounds.unit})`,
    at,
  });
}

/**
 * Sentences of a post, split before folding (folding turns line breaks into spaces). A stop ends
 * a sentence only when a capital or an opening quote follows, so "1.5 km" and "approx. 2,000 km"
 * stay whole; a split that still lands inside a sentence is covered by the window pass below.
 */
const sentences = (text: string) =>
  text
    .split(/(?<=[.!?…])\s+(?=[\p{Lu}«"“])|\n+/u)
    .map(fold)
    .filter(Boolean);

/** The longest run of consecutive sentences a quote is looked for in (a spec list over lines). */
const MAX_WINDOW = 4;

/**
 * The passages of the post that carry the quote, found by containment on folded text - never by
 * character offsets, which folding shifts. A quote crossing a sentence or line boundary
 * ("...range of" / "2,000 km.") is looked for in the smallest run of consecutive sentences that
 * holds it. Empty when the quote is not in the post.
 */
export function evidencePassages(text: string, quote: string): string[] {
  const needle = fold(quote);
  if (!needle) return [];
  const parts = sentences(text);
  for (let size = 1; size <= Math.min(MAX_WINDOW, parts.length); size++) {
    const found: string[] = [];
    for (let i = 0; i + size <= parts.length; i++) {
      const window = parts.slice(i, i + size).join(" ");
      if (window.includes(needle)) found.push(window);
    }
    if (found.length) return found;
  }
  return [];
}

type Naming = { own: boolean; other?: Drone };

/**
 * Catalog systems a passage names by a distinctive name, per catalog and passage. The same
 * sentence or post is checked for every claim it carries, often across several systems, and the
 * scan over the whole catalog is the verifier's dominant cost. Bounded, since passages are
 * unique per post; the catalog key lets a changed catalog start fresh.
 */
const scans = new WeakMap<readonly Drone[], Map<string, Drone[]>>();
const MAX_SCANS = 5000;

function distinctivelyNamed(passage: string, catalog: readonly Drone[]): Drone[] {
  let byPassage = scans.get(catalog);
  if (!byPassage) scans.set(catalog, (byPassage = new Map()));
  const hit = byPassage.get(passage);
  if (hit) return hit;
  const found = catalog.filter((d) =>
    catalogNames(d).some((name) => distinctive(name) && mentionsName(passage, name)),
  );
  if (byPassage.size >= MAX_SCANS) byPassage.clear();
  byPassage.set(passage, found);
  return found;
}

/** Whether a passage names this system, and which other distinctive catalog system it names. */
function naming(passage: string, drone: Drone, catalog: readonly Drone[]): Naming {
  const own = catalogNames(drone).some((name) => mentionsName(passage, name));
  const other = distinctivelyNamed(passage, catalog).find((d) => d.id !== drone.id);
  return other ? { own, other } : { own };
}

/**
 * Does the passage this figure came from name the system it is filed under (plan §4.6)?
 *
 * Anchored to the evidence sentence, not the post: in a post about several systems the drone's
 * own name appears somewhere almost by definition, so a whole-post match would pass exactly the
 * misattribution this check exists to catch. When the sentence names no system the verdict is
 * uncertain - including for a post about one system only, since such a post can still carry a
 * sentence about something it never names. Uncertain is applicable, so it keeps the claim from
 * reading as verified; that lowers the verified share, and the lower number is the honest one.
 */
function identityCheck(
  drone: Drone,
  claim: SpecClaim,
  text: string | undefined,
  catalog: readonly Drone[],
  at: string,
): VerificationCheck {
  const quote = claim.evidence?.trim() || claim.raw?.trim() || "";
  const sourceId = claim.sourceId ? { sourceId: claim.sourceId } : {};
  // Without the post, the quote is the only passage there is; a bare fragment then names nothing,
  // and the evidence check has already made the claim uncertain for want of a source.
  const passages = text ? evidencePassages(text, quote) : quote ? [fold(quote)] : [];
  if (!passages.length && !text)
    return check({
      kind: "identity",
      verdict: "uncertain",
      applicable: false,
      detail: "no evidence text to check identity against",
      at,
    });

  // A sentence that names this system and another ("Unlike the Shahed-136, the Lancet-3 has a
  // range of 40 km") is ambiguous, not a pass: which of the two the figure belongs to is the
  // interpretation the AI judge exists for (plan §4.3 step 5).
  const named = passages.map((p) => naming(p, drone, catalog));
  const own = named.some((n) => n.own);
  const other = named.find((n) => n.other)?.other;
  const evidence = passages.join(" … ");
  if (own && !other)
    return check({
      kind: "identity",
      verdict: "pass",
      applicable: true,
      confidence: 0.8,
      detail: "the evidence sentence names this system",
      evidence,
      ...sourceId,
      at,
    });
  if (other && !own)
    return check({
      kind: "identity",
      verdict: "fail",
      applicable: true,
      confidence: 0.7,
      detail: `the evidence sentence names ${other.name}, not ${drone.name}`,
      evidence,
      ...sourceId,
      at,
    });
  if (own && other)
    return check({
      kind: "identity",
      verdict: "uncertain",
      applicable: true,
      confidence: 0.3,
      detail: `the evidence names both ${drone.name} and ${other.name}`,
      evidence,
      ...sourceId,
      at,
    });

  // The sentence names no system: fall back to the post, but never to a pass.
  const post: Naming = text ? naming(fold(text), drone, catalog) : { own: false };
  return check({
    kind: "identity",
    verdict: "uncertain",
    applicable: true,
    confidence: post.own ? 0.5 : 0.2,
    detail: post.own
      ? "the evidence sentence names no system; the post names this one"
      : post.other
        ? `the evidence sentence names no system; the post names ${post.other.name}`
        : "the evidence sentence names no system",
    ...(evidence ? { evidence } : {}),
    ...sourceId,
    at,
  });
}

/** The outlet behind a source string, so two feeds or reposts of one outlet count once. */
const outletOf = (source: string) => outletKey(source) || source.trim().toLowerCase();

/**
 * Distinct outlets that state the same figure for this attribute. Keyed by outlet, not by source
 * string, so "Ukrinform (War)" and "Ukrinform (Economy)" are one voice. Weighting by an outlet's
 * track record belongs to the cross-source check (plan §4.3 step 6), which has the archive.
 */
export function independentSourceCount(spec: SpecAttribute, claim: SpecClaim): number {
  const mine = correctedPoint(claim) ?? rawPoint(spec, claim);
  const own = outletOf(claim.source);
  const sources = new Set<string>([own]);
  for (const other of spec.claims) {
    if (other === claim) continue;
    const outlet = outletOf(other.source);
    if (outlet === own) continue;
    if (!claimCounts(other)) continue;
    const theirs = correctedPoint(other) ?? rawPoint(spec, other);
    if (mine && theirs) {
      if (mine.unit && theirs.unit && mine.unit !== theirs.unit) continue;
      const scale = Math.max(Math.abs(mine.value), Math.abs(theirs.value), 1e-9);
      if (Math.abs(mine.value - theirs.value) / scale <= 0.05) sources.add(outlet);
      continue;
    }
    const a = String(claim.value).trim().toLowerCase();
    if (a && a === String(other.value).trim().toLowerCase()) sources.add(outlet);
  }
  return sources.size;
}

/**
 * Verify one claim. Undefined means there is nothing to verify: a hand-entered analyst claim is
 * already the highest authority and is deliberately left without a machine verdict.
 */
export function verifyClaim(input: {
  drone: Drone;
  spec: SpecAttribute;
  claim: SpecClaim;
  text?: string | undefined;
  catalog?: readonly Drone[];
  at?: string;
}): ClaimVerification | undefined {
  const { drone, spec, claim, text, catalog = [drone], at = new Date().toISOString() } = input;
  if (claim.source === ANALYST_SOURCE || claim.extractionEngine === "analyst") return undefined;

  const checks = [
    evidenceCheck(claim, text, at),
    unitCheck(spec, claim, at),
    boundsCheck(spec, claim, at),
    identityCheck(drone, claim, text, catalog, at),
  ];
  const applicable = checks.filter((c) => c.applicable);
  const failed = applicable.find((c) => c.verdict === "fail");
  const state = failed
    ? "rejected"
    : applicable.length > 0 && applicable.every((c) => c.verdict === "pass")
      ? "verified"
      : "uncertain";
  const confidence =
    state === "rejected"
      ? 0
      : state === "verified"
        ? Math.min(...applicable.map((c) => c.confidence ?? 0.5))
        : Math.min(
            0.5,
            ...applicable.filter((c) => c.verdict === "uncertain").map((c) => c.confidence ?? 0.3),
          );
  const coverage = applicable.length
    ? applicable.filter((c) => c.verdict !== "uncertain").length / applicable.length
    : 0;
  return {
    state,
    checks,
    confidence,
    coverage,
    independentSources: independentSourceCount(spec, claim),
    verifierVersion: VERIFIER_VERSION,
    at,
  };
}

/** Same verdict, ignoring when it was computed. Keeps a stable catalogue from being rewritten. */
export function sameVerification(
  a: ClaimVerification | undefined,
  b: ClaimVerification | undefined,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.state === b.state &&
    a.confidence === b.confidence &&
    a.coverage === b.coverage &&
    a.independentSources === b.independentSources &&
    a.verifierVersion === b.verifierVersion &&
    a.checks.length === b.checks.length &&
    a.checks.every((c, i) => {
      const d = b.checks[i];
      return (
        !!d &&
        c.kind === d.kind &&
        c.verdict === d.verdict &&
        c.applicable === d.applicable &&
        c.confidence === d.confidence &&
        c.detail === d.detail
      );
    })
  );
}

/**
 * Verify every claim of an entry, with each claim's own source text supplied by `textFor`.
 * `shouldVerify` lets the ingest path verify only the claims a post just added, so old claims
 * are not re-checked against another post's text. Claims the analyst entered are left untouched.
 */
export function verifyDrone(
  drone: Drone,
  textFor: ClaimTextResolver,
  catalog: readonly Drone[] = [],
  at = new Date().toISOString(),
  shouldVerify: (claim: SpecClaim) => boolean = () => true,
): Drone {
  let changed = false;
  const specs = drone.specs.map((spec) => {
    let specChanged = false;
    const claims = spec.claims.map((claim) => {
      if (!shouldVerify(claim)) return claim;
      const verification = verifyClaim({ drone, spec, claim, text: textFor(claim), catalog, at });
      if (!verification || sameVerification(claim.verification, verification)) return claim;
      specChanged = true;
      changed = true;
      return { ...claim, verification };
    });
    return specChanged ? { ...spec, claims } : spec;
  });
  return changed ? { ...drone, specs } : drone;
}

/**
 * Verify only the claims a post just added, against that post's text.
 *
 * `known` is the set of claim ids that existed before the write, so a merge never re-checks an
 * older claim against a newer post's text - a unit or an identity that fails there is a fact about
 * the wrong article, not about the claim. Claims without an id are new by definition.
 */
export function verifyNewClaims(
  drone: Drone,
  known: ReadonlySet<string>,
  text: string | undefined,
  catalog: readonly Drone[] = [],
  at = new Date().toISOString(),
): Drone {
  return verifyDrone(
    drone,
    () => text,
    catalog,
    at,
    (claim) => !claim.id || !known.has(claim.id),
  );
}

export interface VerificationCoverage {
  total: number;
  /** Analyst-entered claims, which carry no machine verdict by design. */
  analyst: number;
  unverified: number;
  verified: number;
  uncertain: number;
  rejected: number;
  /** Non-analyst claims carrying any verification record, over non-analyst claims. */
  checked: number;
}

/** Coverage across the catalogue, for the Autonomy page. */
export function verificationCoverage(
  drones: readonly Drone[],
  isAnalyst: (claim: SpecClaim) => boolean = (c) =>
    c.source === ANALYST_SOURCE || c.extractionEngine === "analyst",
): VerificationCoverage {
  const out: VerificationCoverage = {
    total: 0,
    analyst: 0,
    unverified: 0,
    verified: 0,
    uncertain: 0,
    rejected: 0,
    checked: 0,
  };
  for (const drone of drones)
    for (const spec of drone.specs)
      for (const claim of spec.claims) {
        out.total++;
        if (isAnalyst(claim)) {
          out.analyst++;
          continue;
        }
        if (!claim.verification) {
          out.unverified++;
          continue;
        }
        out.checked++;
        out[claim.verification.state]++;
      }
  return out;
}

/** Claims a reader should look at first: rejected, then uncertain. */
export function verificationExceptions(drones: readonly Drone[]) {
  return drones.flatMap((drone) =>
    drone.specs.flatMap((spec) =>
      spec.claims.flatMap((claim) => {
        const v = claim.verification;
        if (!v || v.state === "verified") return [];
        return [
          {
            droneId: drone.id,
            droneName: drone.name,
            specKey: spec.key,
            specLabel: spec.label,
            claim,
            verification: v,
            /** The failed or uncertain check that matters most. */
            check:
              v.checks.find((c) => c.verdict === "fail") ??
              v.checks.find((c) => c.verdict === "uncertain" && c.applicable),
          },
        ];
      }),
    ),
  );
}
