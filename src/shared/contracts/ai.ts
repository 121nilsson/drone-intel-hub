import type { Drone, Extraction } from "@/entities/drone/types";

/** Inference contract — any engine (heuristic, NIM, OpenAI-compatible) can implement it. */
export interface IntelExtractor {
  readonly tier: 1 | 2;
  readonly label: string;
  extract(raw: string, catalog: Drone[], context?: Extraction): Promise<Extraction>;
}

export interface BriefingSummarizer {
  summarize(context: string): Promise<string>;
}

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
