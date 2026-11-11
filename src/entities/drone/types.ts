import type { Money, MoneyRange } from "@/entities/normalization/currency";
import type { NormalizedRFLink } from "@/entities/normalization/rf";
import type { NormalizedQuantity } from "@/entities/normalization/units";

export type Domain = "Air" | "Land" | "Sea" | "Multi";
export const DOMAINS: Domain[] = ["Air", "Land", "Sea", "Multi"];

/**
 * What produced a claim: the prompt, pipeline, rule set and name that were in force. A claim
 * without lineage means "unknown", not "none"; it is never backfilled.
 */
export interface ClaimLineage {
  promptVersion?: string;
  promptHash?: string;
  pipelineVersion?: string;
  rulesVersion?: number;
  /** Ids of generated rules (cue, context filter, unit scale) that shaped this spec. */
  ruleIds?: string[];
  /** The catalogue name or alias string that resolved the passage to this system. */
  matchedName?: string;
  matchedVia?: "name" | "alias" | "rule_alias";
  /** SimHash of the post the claim came from (the dispatch's contentHash), when known. */
  contentHash?: string;
}

export interface SpecClaim {
  /** Stable identity assigned at creation. Older claims without one fall back to a composite key. */
  id?: string;
  value: number | string;
  /** How this claim was produced. Absent on claims written before lineage existed. */
  lineage?: ClaimLineage;
  /** Verbatim text when the value was parsed from a string. */
  raw?: string;
  /** Parsed measurement in canonical units. Absent means not parsed. */
  normalized?: NormalizedQuantity;
  /** Deterministic parser confidence, 0..1. */
  normalizationConfidence?: number;
  source: string;
  /** RawDispatch id when this claim came from ingestion. */
  sourceId?: string;
  evidence?: string;
  extractionConfidence?: number;
  extractionEngine?: string;
  model?: string;
  date: string; // ISO
  /**
   * The key of the claim this one was moved from, when an analyst filed it under another
   * attribute. Undoing the move finds the copy through it.
   */
  movedFrom?: string;
  /** Entry the claim was moved from, when it crossed systems rather than attributes. */
  movedFromDroneId?: string;
  /**
   * The cross-system move that filed this copy. Unlike `movedFrom`, it survives a re-analysis
   * that recreates the source claim with a new id, so undo still finds the copy.
   */
  movedFromMoveId?: string;
  /**
   * Set when the deep model was asked which report behind a contested spec this one supports
   * (features/intake/contradictions.ts). An "outlier" verdict never removes or rewrites the
   * claim - the report said what it said - it records what the check concluded, so a reader
   * sees an adjudicated disagreement instead of an unresolved one.
   */
  adjudication?: {
    verdict: "supported" | "outlier";
    confidence: number;
    at: string;
    reason?: string;
  };
  /**
   * An analyst's verdict on this claim, which outranks the contradiction check. Kept apart from
   * `adjudication` rather than written over it: the two verdicts side by side are what later
   * measures how often the model's check agrees with a person.
   */
  review?: ClaimReview;
  /**
   * What the deterministic corrector found wrong with this claim (auto-correction.ts). Like the
   * other verdicts it never rewrites the claim; consensus reads it only once `applied`.
   */
  autoCorrection?: AutoCorrection;
  /**
   * The machine's own check of this claim against the source and the attribute it was filed
   * under (verification.ts). Additive and separate from every other verdict: it never removes
   * a claim by itself in Phase 1 - it records whether the evidence, units, bounds and identity
   * hold, so the autonomy loops can be measured before any human gate is removed.
   */
  verification?: ClaimVerification;
  /**
   * A second reader's answer: a different model from the one that extracted the claim was asked
   * whether the post states it (entailment.ts). Kept apart from `verification` because in Phase 2
   * it is measured against the human seed set before it may change any claim's state; until then
   * nothing reads it but the measurement.
   */
  entailment?: ClaimEntailment;
}

/** supported: the post states it. unsupported: it does not. uncertain: the reader cannot say. */
export type EntailmentVerdict = "supported" | "unsupported" | "uncertain";

export interface ClaimEntailment {
  verdict: EntailmentVerdict;
  /**
   * The passage the reader gave as its reason, only when it was found in the post. A passage
   * the post does not contain makes the verdict `uncertain`, whatever the reader said.
   */
  span?: string;
  /** Why a verdict was downgraded or could not be given, in the verifier's own words. */
  note?: string;
  provider: string;
  model: string;
  /**
   * checked: the claim names the model that extracted it, and the reader is a different one.
   * unknown: the claim names none (written before that was recorded), so the reader may be the
   * extractor. Reported apart, because a model grading its own reading is not a second reader.
   */
  independence: "checked" | "unknown";
  /** The post text this verdict was given on, hashed: a changed post is judged again. */
  textHash: string;
  version: string;
  at: string;
}

export type VerificationVerdict = "pass" | "fail" | "uncertain";

/** What the verification checks, as a whole, conclude about a claim. */
export type VerificationState = "verified" | "uncertain" | "rejected";

export type VerificationKind =
  | "evidence_span"
  | "unit_dimension"
  | "bounds"
  | "identity"
  | "target"
  | "value_in_quote"
  | "attribute_words"
  | "ai_entailment"
  | "cross_source"
  | "reference";

export interface VerificationCheck {
  /** Stable per kind, so a recomputation can be compared without looking at the timestamp. */
  id: string;
  kind: VerificationKind;
  verdict: VerificationVerdict;
  /**
   * False when the check has nothing to say about this claim (a text value has no unit, a
   * seed claim has no source post). An inapplicable check is reported but never lowers coverage.
   */
  applicable: boolean;
  /** How sure the check is of its own verdict, 0..1. */
  confidence?: number;
  detail?: string;
  evidence?: string;
  sourceId?: string;
  model?: string;
  verifierVersion: string;
  at: string;
}

export interface ClaimVerification {
  state: VerificationState;
  checks: VerificationCheck[];
  /** Confidence of the weakest passing check; 0 when any applicable check failed. */
  confidence: number;
  /** Share of applicable checks that reached a definite pass or fail. */
  coverage: number;
  /** Distinct outlets whose claims on the same attribute state the same figure. */
  independentSources: number;
  verifierVersion: string;
  at: string;
}

export interface AutoCorrection {
  /** "unit": the figure was read in the wrong unit; "implausible": no reading of it is possible. */
  kind: "unit" | "implausible";
  /** "consensus": the other sources agree on another figure; "bounds": physically out of range. */
  basis: "consensus" | "bounds";
  /** The corrected point value, in `unit` (kind "unit" only). */
  value?: number;
  unit?: string;
  /** What the reading was multiplied by to reach `value`. */
  factor?: number;
  /**
   * Whether consensus uses the correction. Set by the corrector from the trust analysts have given
   * this kind of correction; until then it is a proposal shown beside the claim.
   */
  applied: boolean;
  at: string;
}

/** What an analyst found wrong with a claim. */
export type ClaimIssue =
  /** The report gives the figure, but the figure is wrong. */
  | "value"
  /** The figure was read in the wrong unit or misparsed. */
  | "unit"
  /** The report is about another system. */
  | "system"
  /** The figure is right, but it describes another attribute of this system. */
  | "attribute";

export type AliasKind =
  | "designation"
  | "reporting_name"
  | "transliteration"
  | "slang"
  /** Migrated from the pre-claim flat list; treated as verified by the analyst sweep. */
  | "legacy";

export interface AliasReview {
  verdict: "confirmed" | "rejected";
  at: string;
  by: "analyst";
  /** On the source entry: the entry the alias was filed under instead. */
  movedToDroneId?: string;
  /** On the filed copy: the entry the alias came from. */
  movedFromDroneId?: string;
  /**
   * Identity of the cross-system move, shared by both review marks, so a re-ingested claim and
   * its undo still find each other across two independently written entries.
   */
  moveId?: string;
}

/** One report's reading of a system's country of origin. */
export interface OriginClaim {
  /** ISO 3166-1 alpha-2, as countryCode() normalizes it ("EU" for a joint European programme). */
  country: string;
  /** "Outlet · URL", same convention as SpecClaim.source. */
  source: string;
  sourceId?: string;
  /** The candidate it came from: one claim per candidate, so re-reading a post adds nothing. */
  candidateId?: string;
  at: string;
}

/**
 * The analyst's decision on an origin. `turnedDown` are the countries the reports proposed that
 * the analyst ruled out; they are not proposed again, however many more reports say so.
 */
export interface OriginReview {
  origin: string;
  turnedDown: string[];
  at: string;
  by: "analyst";
}

export interface AliasClaim {
  /**
   * Stable identity: `alias-${fold}`, the phonetic key of the declension-stripped alias. One
   * claim per folded shape, so a verbatim verdict survives re-ingestion of any inflected or
   * transliterated form of the same name.
   */
  id: string;
  alias: string;
  status: "verified" | "candidate" | "rejected";
  kind?: AliasKind;
  /** Provenance of the suggestion, same convention as SpecClaim.source ("Outlet · URL"). */
  source?: string;
  sourceId?: string;
  /** The dispatch candidate this suggestion came from, so a panel can open the source post. */
  sourceCandidateId?: string;
  evidence?: string;
  firstSeen: string;
  /** Other catalog entries this alias collides with (it is their canonical identity). */
  conflictWithDroneIds?: string[];
  review?: AliasReview;
}

export interface ClaimReview {
  verdict: "confirmed" | "rejected";
  /** Set when rejected. */
  issue?: ClaimIssue;
  /** The attribute the figure was filed under instead, when the analyst moved it. */
  movedTo?: string;
  /** The entry the figure was filed under instead, when it was moved across systems. */
  movedToDroneId?: string;
  /**
   * Identity of the cross-system move. The source claim's own id changes when a post is
   * re-analysed; this does not, so the filed copy can still be found for undo.
   */
  moveId?: string;
  at: string;
  by: "analyst";
}

/** Schema-less attribute: any key may be discovered by AI or analysts. */
export interface SpecAttribute {
  key: string;
  label: string;
  unit?: string;
  /** Canonical measurement, e.g. "range.max". Unmapped keys keep their original key. */
  semantic?: string;
  canonicalUnit?: string;
  claims: SpecClaim[];
  discoveredBy: "seed" | "ai" | "analyst";
  /**
   * When the deep model last checked this spec's disagreement. Keeps the check one-shot: a
   * claim dated after it re-opens the question, otherwise the spec is not asked again.
   */
  contradictionCheckedAt?: string;
}

export type RFRole =
  "uplink" | "downlink" | "video" | "gnss" | "antijam" | "telemetry" | "tether" | "unknown";
export interface RFLink {
  role: RFRole;
  /** Raw band label as written. Evidence only; bands are recomputed from freqMHz. */
  band: string;
  freqMHz?: [number, number];
  ieeeBands?: string[];
  natoBands?: string[];
  protocols?: string[];
  isFiberOptic?: boolean;
  confidence?: number;
  tacticalTag?: string;
  notes?: string;
}

export interface SupplyComponent {
  part: string;
  manufacturer: string;
  origin: string; // country code
  category?: string;
  model?: string;
  evidence?: string;
  confidence?: number;
  sourceId?: string;
}

export interface PayloadObservation {
  name: string;
  category?: string;
  quantity?: number;
  weightKg?: number;
  evidence?: string;
  confidence?: number;
  sourceId?: string;
}

export interface SensorObservation {
  name: string;
  category: "camera" | "eo" | "ir" | "thermal" | "radar" | "lidar" | "other";
  model?: string;
  manufacturer?: string;
  quantity?: number;
  evidence?: string;
  confidence?: number;
  sourceId?: string;
}

export type EvolutionKind = "frequency" | "motor" | "payload" | "airframe" | "mention" | "other";
export interface EvolutionEvent {
  date: string;
  kind: EvolutionKind;
  description: string;
  source: string;
}

/** Wikipedia/Wikidata identity attached by the reference import. Not a spec claim. */
export type OrganizationRole =
  | "manufacturer"
  | "developer"
  | "supplier"
  | "operator"
  | "exporter"
  | "sanctions subject"
  | "other";

export interface OrganizationLink {
  /** Canonical key used to join mentions that do not share a full legal name. */
  organizationId: string;
  name: string;
  role: OrganizationRole;
  country?: string;
  /** Preserves how we learned this association. */
  source?: string;
  evidence?: string;
  confidence?: number;
  firstSeen?: string;
  lastSeen?: string;
}

export function organizationKey(name: string): string {
  return (
    name
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u0430-\u044f]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "unknown"
  );
}

export interface DroneReference {
  wikidataId: string;
  alsoIds: string[];
  lang: "en" | "ru" | "uk";
  title: string;
  revisionId: number;
  url: string;
  license: "CC BY-SA 4.0";
  importedAt: string;
}

/**
 * One Wikidata item, already resolved to catalog fields. The server returns these;
 * `applyReference` decides whether each one fills an existing drone or becomes a new card.
 */
export interface ReferenceCard {
  wikidataId: string;
  name: string;
  cyrillic?: string;
  aliases: string[];
  domain: Domain;
  origin: string;
  manufacturer?: string;
  operators: string[];
  summary: string;
  lang: "en" | "ru" | "uk";
  title: string;
  revisionId: number;
  url: string;
  /**
   * Figures from the article's infobox or specification section, plus Wikidata quantities the
   * article lacks. Each carries the template line it was read from as evidence.
   */
  specs?: ExtractedSpec[];
}

export interface Drone {
  id: string;
  name: string;
  cyrillic?: string;
  /** Flat verified aliases: the derived view every consumer reads, see `claimsToAliases`. */
  aliases: string[];
  /**
   * Alias lifecycle behind the view above: a model suggestion arrives as a candidate and the
   * flat list stays verified-only until an analyst approves it. Absent on entries written
   * before the claim system; those behave exactly as the flat list always did.
   */
  aliasClaims?: AliasClaim[];
  domain: Domain;
  origin: string; // country of origin code
  /**
   * The country each report gave as this system's origin (entities/drone/origin-audit.ts). The
   * stored origin is set once, at promotion; these are what later reports say, so a wrong first
   * reading can be noticed and proposed for correction instead of standing forever.
   */
  originClaims?: OriginClaim[];
  /** The analyst's last decision on the origin; it outranks every report (origin-audit.ts). */
  originReview?: OriginReview;
  manufacturer?: string; // company that designed/produces the system
  organizationLinks?: OrganizationLink[]; // roles, evidence, and first/last-seen provenance
  operators: string[]; // battlefield operator codes
  /** Raw propulsion text. Never replaced by the canonical id. */
  propulsion: string;
  propulsionId?: string;
  /** Raw installation / airframe text. Never replaced by the canonical id. */
  installation?: string;
  installationId?: string;
  summary: string;
  /** Cached English translation of a non-English source-language summary. */
  summaryEnglish?: string;
  /** AI-generated dossier brief. Long-lived and cached; refreshed on manual request or staleness. */
  /** Structured AI dossier brief parsed from the model output. */
  llmBrief?: {
    overview: string;
    verified: string[];
    caveats: string[];
    provenance: string[];
    nextChecks: string[];
  };
  llmSummary?: string; /** When the current AI brief was generated. */
  llmSummaryGeneratedAt?: string;
  /** Fingerprint of system facts used for the cached AI brief, so merges/edits invalidate it. */
  llmSummaryFingerprint?: string;
  specs: SpecAttribute[];
  /**
   * What reports say happened with the system - launched, intercepted, delivered, produced - over
   * a period (activity.ts). Kept apart from `specs`: "launched 2,800 in August" is not a property
   * of the system, and filed as a spec it became an attribute per month and a meaningless
   * consensus. Nothing reads it into consensus; it is a series, not a figure.
   */
  activity?: ActivityRecord[];
  rf: RFLink[];
  components: SupplyComponent[];
  payloads?: PayloadObservation[];
  sensors?: SensorObservation[];
  evolution: EvolutionEvent[];
  counterpartIds: string[];
  /**
   * Explicit family relationship. Variants are not counterparts. Legacy: the typed `relations`
   * below supersede these. Every reader goes through system-hierarchy.ts, which reads both until
   * the repair has copied them all into `relations`; the pipeline still writes these, and every
   * relation write keeps them in step. To retire once the pipeline writes typed relations.
   */
  variantOfId?: string;
  variantIds?: string[];
  /**
   * What kind of system this entry is. `family` is an umbrella (Geran, Shahed): not a build
   * standard, the entry a report naming the family generically ("Gerans", "Shahed-type drones")
   * belongs to, and the one its variants point at.
   */
  systemClass?: SystemClass;
  /**
   * How the system flies, when that changes what a plausible figure is. Set by the analyst only:
   * it loosens the verifier's bounds, so it is never inferred from a report's wording.
   */
  flightProfile?: FlightProfile;
  /** Typed, directed relations to other entries, each stated once (system-hierarchy.ts). */
  relations?: SystemRelationClaim[];
  /**
   * Entries the analyst has said are a different system, though they share names: the family
   * audit does not propose merging them again.
   */
  distinctFrom?: string[];
  reference?: DroneReference;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractedSpec {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  semantic?: string;
  raw?: string;
  normalized?: NormalizedQuantity;
  money?: Money;
  moneyRange?: MoneyRange;
  /** Canonical measurement unit set by normalization (e.g. "USD" for cost.unit). */
  canonicalUnit?: string;
  /** Verbatim clause supporting this observation. */
  evidence?: string;
  /**
   * Who stands behind the claim after an AI pass judged the heuristic's observations: "both"
   * (the AI restated it), "heuristic" (the AI was shown it and dropped it), "ai" (AI only).
   * Absent on heuristic-only extractions and on candidates stored before provenance existed.
   */
  provenance?: SpecProvenance;
  /** Generated rules (cue, context filter, unit scale) that shaped this observation. */
  ruleIds?: string[];
}

export type SpecProvenance = "heuristic" | "ai" | "both";

export interface DetectedSystem {
  name: string;
  matchId?: string;
  variantOf?: string;
  /** How the passage was tied to this system: its name, one of its aliases, or a rule-added alias. */
  matchedVia?: "name" | "alias" | "rule_alias";
}

export interface SystemExtraction extends DetectedSystem {
  aliases?: string[];
  domain?: Domain;
  origin?: string;
  manufacturer?: string;
  organizationLinks?: OrganizationLink[];
  operators?: string[];
  propulsion?: string;
  installation?: string;
  guidance?: string[];
  specs: ExtractedSpec[];
  rfBands: string[];
  components?: SupplyComponent[];
  payloads?: PayloadObservation[];
  sensors?: SensorObservation[];
  confidence: number;
  rationale?: string;
}

export interface ExtractionMetadata {
  schemaVersion: number;
  engine: "heuristic" | "ai" | "combined";
  model?: string;
  promptVersion?: string;
  promptHash?: string;
  escalationReasons?: string[];
  analyzedAt: string;
}

export interface Extraction {
  name?: string;
  aliases: string[];
  domain?: Domain;
  origin?: string;
  manufacturer?: string;
  operators: string[];
  propulsion?: string;
  propulsionId?: string;
  installation?: string;
  installationId?: string;
  specs: ExtractedSpec[];
  /** Raw band strings from the extractor. Evidence; normalization reads these. */
  rfBands: string[];
  rf?: NormalizedRFLink[];
  systems?: DetectedSystem[];
  /** Per-system results prevent facts from a multi-system report being cross-attributed. */
  systemExtractions?: SystemExtraction[];
  components?: SupplyComponent[];
  payloads?: PayloadObservation[];
  sensors?: SensorObservation[];
  guidance?: string[];
  matchId?: string;
  confidence: number; // 0..1
  rationale: string;
  metadata?: ExtractionMetadata;
}

export type CandidateStatus = "pending" | "promoted" | "merged" | "discarded";
export interface CandidateQuality {
  /** Model/system quality score used for triage. */
  confidence: number;
  /** Number of extracted specs retained for this candidate. */
  specCount: number;
  /** Specs whose evidence text was actually retained after the autonomy brake. */
  evidenceSpecCount: number;
  /** Systems the extraction attributed this candidate/text to. */
  systemNames: string[];
  /** Candidate quality risks that keep it in review. */
  risks: string[];
  /** Runtime triage outcome this candidate reached. */
  decision?: "auto-merged" | "auto-promoted" | "queued" | "auto-discarded";
}

export interface Candidate {
  id: string;
  raw: string;
  source: string;
  /**
   * The archived post this came from; absent for pasted text. Promote and merge stamp it on the
   * claims they write, so a later verifier run can find the post again.
   */
  dispatchId?: string;
  /** When that post was published: an activity figure's month without a year is placed by it. */
  publishedAt?: string;
  createdAt: string;
  tier: 1 | 2;
  extraction: Extraction;
  status: CandidateStatus;
  resolvedInto?: string;
  supersededBy?: string;
  /** Who resolved it; absent on candidates resolved before auto-triage existed. */
  resolvedBy?: "auto" | "analyst";
  /** When the deep model was asked whether this is its matched catalog entry; asked once. */
  adjudicatedAt?: string;
  /** Explainability snapshot captured at ingest time. */
  quality?: CandidateQuality;
}

/** Plain-text country code; rendered flags live in `CountryBadge` (flag-icons). */
export const flag = (c: string) => c.trim().toUpperCase();

/** What a report counted. */
export type ActivityMetric =
  "launched" | "intercepted" | "delivered" | "produced" | "kills" | "ordered";

/** One activity figure from one report, with the period it covers when the report says. */
export interface ActivityRecord {
  id: string;
  metric: ActivityMetric;
  /** The attribute the extractor filed it under, kept so nothing it said is lost. */
  label: string;
  /** The figure as the report gave it ("more than 2,800"). */
  raw: string;
  /** A point, or a bound when the report gave one ("more than" → min). */
  quantity: { value?: number; min?: number; max?: number; approximate?: boolean };
  /** What was counted, when the report names it ("missiles", "drones", "rounds"). */
  unit?: string;
  /** The period the figure covers, as an ISO date span; `label` is how the report put it. */
  period?: { from?: string; to?: string; label: string };
  /** A rate rather than a total ("per month", "a year"). */
  per?: "day" | "week" | "month" | "year";
  source: string;
  sourceId?: string;
  evidence?: string;
  /** When the report was read. */
  date: string;
  /** When the post was published, which a month without a year was placed against. */
  publishedAt?: string;
  extractionEngine?: string;
  model?: string;
  /** Who stood behind the figure after an AI pass (ExtractedSpec.provenance); absent when repaired. */
  provenance?: SpecProvenance;
}

/**
 * platform: a complete vehicle (aircraft, UAV, USV, tank). family: an umbrella over variants of
 * one design (Geran, Shahed). complex: a distributed battery of radar, command and launchers
 * (Patriot). subsystem: an integrated unit of one (radar, ground station, engine). effector: an
 * expended munition (missile, glide bomb). payload_ew: a removable pod, jammer or optronic ball.
 */
export type SystemClass =
  "platform" | "family" | "complex" | "subsystem" | "effector" | "payload_ew";

/** A trajectory the general plausibility bounds do not fit (auto-correction.ts). */
export type FlightProfile = "ballistic";

/**
 * The relations that are stored, each in one direction only, from the entry that depends on the
 * other: a variant points at its family, a clone at its origin, a radar at its battery, a missile
 * at its launcher, a pod at its carrier. `counterpart_to` is symmetric and stored once.
 */
export type RelationKind =
  "variant_of" | "derived_from" | "subsystem_of" | "effector_for" | "carried_by" | "counterpart_to";

/** How a relation reads from the other end. Never stored: generated by the resolver. */
export type RelationDisplayKind =
  RelationKind | "has_variant" | "parent_of" | "has_subsystem" | "operates_effector" | "carries";

export interface SystemRelationClaim {
  id: string;
  targetSystemId: string;
  kind: RelationKind;
  /**
   * verified: stated by an analyst, or carried over from a link the catalogue already held.
   * candidate: suggested by a report, waiting for review; nothing reads it as true until then.
   * rejected: reviewed and turned down, kept so it is not suggested again.
   */
  status: "verified" | "candidate" | "rejected";
  role?: string;
  notes?: string;
  /** "Outlet · URL" of the report that suggested it. */
  source?: string;
  sourceId?: string;
  sourceCandidateId?: string;
  /** The sentence that suggested it. */
  evidence?: string;
  confidence?: number;
  date: string;
  /**
   * Set when confirming this claim wrote the legacy link it mirrors (`variantOfId`), so taking
   * the verdict back removes only a link the verdict made, never one that predates it.
   */
  wroteLegacy?: boolean;
  /** Set when rejecting this claim removed the legacy link, so taking it back restores it. */
  clearedLegacy?: boolean;
  /** The analyst's verdict, which outranks `status` (as on an alias claim). */
  review?: { verdict: "confirmed" | "rejected"; by: "analyst"; at: string; notes?: string };
}
