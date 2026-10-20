import type { Candidate, Drone, Extraction } from "@/entities/drone/types";
import type { Procurement } from "@/entities/procurement/types";
import type { RuleSnapshot } from "@/shared/contracts/rules";

/** Inference contract — any engine (heuristic, NIM, OpenAI-compatible) can implement it. */
export interface IntelExtractor {
  readonly tier: 1 | 2;
  readonly label: string;
  extract(
    raw: string,
    catalog: Drone[],
    context?: Extraction,
    options?: { rules?: RuleSnapshot },
  ): Promise<Extraction>;
}

/**
 * The deep model's verdict on "is the system in this report that catalog entry?" - one entry,
 * yes or no, so it can be asked cheaply about candidates the pipeline matched without confidence.
 */
export type Adjudicator = (
  candidate: Candidate,
  target: Drone,
) => Promise<{ same: boolean; confidence: number; reason?: string }>;

/**
 * The deep model's verdict on one contested figure: of the reports behind a spec's conflicting
 * claims, which value is best supported. One disputed spec per call - the same shape of cheap,
 * targeted question as Adjudicator, so it can be asked unattended after every sync.
 */
export interface ContradictionInput {
  drone: Drone;
  /** Human-readable spec identity, e.g. "Range (km)". */
  specLabel: string;
  /** The conflicting claims, in the spec's claim order. */
  claims: {
    value: string;
    source: string;
    evidence?: string;
    /**
     * The same figure read as a number in one unit, when the claim can be read as one.
     *
     * Without it the check compares spellings: "0.8 Mach", "Mach 0.8" and "0.8 Маха" look
     * like three different figures, so the check picks one of them and calls the others
     * outliers. With it, the check sees that they are the same number.
     */
    normalizedValue?: number;
    normalizedUnit?: string;
  }[];
}

export interface ContradictionVerdict {
  /** Index into `claims` of the best-supported value; -1 when the model cannot tell them apart. */
  supported: number;
  confidence: number;
  reason?: string;
}

export type ContradictionAdjudicator = (input: ContradictionInput) => Promise<ContradictionVerdict>;

/**
 * Instructions for the 7-day executive summary. One copy, used by the server-side summary and the
 * browser fallback, so both summarise the same way. The context it receives is built from the
 * week's reporting (features/briefing/briefing-data.ts), not from catalog edits.
 */
export const BRIEFING_SUMMARY_SYSTEM =
  "Write a terse 4-6 sentence executive intelligence summary of the past week's drone and counter-drone reporting, using only the context given. Cover the most reported systems and where they were reported from, systems seen for the first time, notable new specification or capability claims (say when a claim is disputed), and any trend across reports. Name systems; do not list counts for their own sake. No preamble.";

export interface BriefingSummarizer {
  summarize(context: string): Promise<string>;
}

/**
 * Pulls contract, grant and production-deal figures out of a raw report.
 *
 * Separate from IntelExtractor because a procurement record is not a drone spec: it names a
 * deal, not a system, and it lands in its own collection. A function rather than an interface
 * because there is no state to hold - the transport is injected at construction.
 */
export type ProcurementExtractor = (raw: string, source: string) => Promise<Procurement | null>;

/**
 * Every provider that could serve the call is rate-limited, out of credits, rejecting its key,
 * down, or cooling down after one of those. Says nothing about the document, so a queue processor
 * keeps the document pending and backs off instead of recording a degraded result.
 */
export class ProviderOutageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderOutageError";
  }
}

/**
 * One provider as the server resolved it, for the Settings page.
 *
 * Carries `hasKey` and the *name* of the key's environment variable, never the key itself:
 * this whole object is serialised to the browser, and the point of the settings screen is to
 * show which providers are live without becoming a way to read one.
 */
export interface ProviderStatus {
  name: string;
  /** Base URL after the `${NAME}_BASE_URL` override, which is what the fetcher will use. */
  baseUrl: string;
  /** The provider's own default model, used when a caller does not name one. */
  defaultModel: string;
  /**
   * Model this provider serves for tier 1, already resolved through
   * `${NAME}_TIER1_MODEL` -> `tier1Model` -> `defaultModel`.
   *
   * Resolved rather than raw because the fallback chain asks each provider for its OWN model, so
   * "what happens if this provider serves my tier-1 call" is answerable without reimplementing the
   * precedence rules in the browser.
   */
  tier1Model: string;
  /** Tier 2 counterpart of `tier1Model`. */
  tier2Model: string;
  priority: number;
  hasKey: boolean;
  /** Env var the key is read from, so an operator can see what to set - not its value. */
  keyEnv: string;
}

/** Which provider serves which tier, and in what order. */
export interface ProviderTierRoute {
  tier: "tier1" | "tier2";
  primary: string;
  fallbacks: string[];
}

/**
 * The multi-provider layer as actually resolved on the server.
 *
 * This is deliberately separate from the tier1/tier2 model *strings* above: those are what the
 * app asks for, these are what will answer. They can disagree, and that disagreement is exactly
 * what an operator needs to see - a namespaced model id such as `nvidia/…` only exists in one
 * provider's catalogue, so every fallback to a different provider is a request that cannot
 * succeed.
 *
 * `routes` is configuration, not proof of behaviour: whether a given call consults it depends on
 * the caller passing a `tier`, which is a property of the call sites rather than of the provider
 * table. Nothing here claims which of the two paths is live.
 */
export interface ProviderRouting {
  /** All providers the build knows about, in the order they are tried. */
  providers: ProviderStatus[];
  /** Names of the providers that have a usable key, in try order. */
  available: string[];
  /** More than one provider is configured, so a failure falls through to the next. */
  multiProvider: boolean;
  strategy: "round-robin" | "priority" | "random";
  routes: ProviderTierRoute[];
}

/** Non-secret inference fields resolved from the server environment. */
export interface ProviderEnvConfig {
  hasKey: boolean;
  baseUrl?: string;
  tier1Model?: string;
  tier2Model?: string;
  translateModel?: string;
  /** Absent when the server could not read the provider layer (see getStoreStatus). */
  routing?: ProviderRouting;
}

export interface AIProviderSettings {
  baseUrl: string;
  apiKey: string;
  tier1Model: string;
  tier2Model: string;
  translateModel: string;
  escalationThreshold: number;
  autoMergeThreshold: number;
  /** A confident, uncatalogued, uniquely named system is promoted without review. */
  autoPromoteThreshold: number;
  /** Below this a candidate is discarded as noise without review. */
  autoDiscardThreshold: number;
  /** Run deterministic extraction before spending provider quota. */
  heuristicFirst: boolean;
}
