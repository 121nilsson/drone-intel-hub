import { createContext } from "react";
import type {
  AIProviderSettings,
  BriefingSummarizer,
  IntelExtractor,
  ProcurementExtractor,
  ProviderEnvConfig,
} from "@/shared/contracts/ai";
import type { CatalogMutations } from "@/shared/contracts/catalog";
import type { VerificationRunner } from "@/shared/contracts/verification";
import type {
  LocalCandidateRepository,
  LocalDispatchRepository,
  LocalDroneRepository,
  LocalProcurementRepository,
  LocalSourceRepository,
  LocalTaxonomyCandidateRepository,
  LocalTaxonomyRepository,
} from "./storage/local-repository";

/** One frozen read of every repository, taken before the store attaches. */
export interface SeedSnapshots {
  drones: ReturnType<LocalDroneRepository["list"]>;
  candidates: ReturnType<LocalCandidateRepository["list"]>;
  sources: ReturnType<LocalSourceRepository["list"]>;
  dispatches: ReturnType<LocalDispatchRepository["list"]>;
  procurements: ReturnType<LocalProcurementRepository["list"]>;
  taxonomies: ReturnType<LocalTaxonomyRepository["terms"]>;
  taxonomyCandidates: ReturnType<LocalTaxonomyCandidateRepository["list"]>;
}

export interface Services {
  /**
   * What the server rendered: the repositories' contents before anything is attached. A component
   * hydrating after the store has attached must still start from this, or its first client render
   * differs from the HTML and React discards the server markup.
   */
  seed: SeedSnapshots;
  drones: LocalDroneRepository;
  candidates: LocalCandidateRepository;
  sources: LocalSourceRepository;
  dispatches: LocalDispatchRepository;
  procurements: LocalProcurementRepository;
  taxonomies: LocalTaxonomyRepository;
  taxonomyCandidates: LocalTaxonomyCandidateRepository;
  settings: AIProviderSettings;
  saveSettings(s: AIProviderSettings): void;
  /** True when a provider is reachable: an env key or one saved in this browser. */
  aiConfigured: boolean;
  /** True when the credentials come from .env.local rather than this browser. */
  aiKeyFromEnv: boolean;
  /** True when any inference field is supplied by the server environment. */
  aiFromEnv: boolean;
  /**
   * Non-secret inference settings resolved on the server, including the multi-provider table.
   * Null when the server could not be reached or supplied nothing, which the Settings page shows
   * as "unknown" rather than as "no providers".
   */
  providerEnv: ProviderEnvConfig | null;
  tier1: IntelExtractor;
  tier2: IntelExtractor;
  /** Deterministic first pass; separate from outage fallback for explicit orchestration. */
  heuristic: IntelExtractor;
  /** Built-in heuristic engine the pipeline degrades to when an AI tier throws. */
  fallback: IntelExtractor;
  summarizer: BriefingSummarizer;
  /** Fills buyer, programme and announcement date when a post carries a financial figure. */
  procurementExtractor?: ProcurementExtractor;
  /**
   * Catalog edits that span more than one collection: merging two entries, and removing one.
   *
   * Exposed as a contract so a page asks for the operation instead of assembling the
   * repositories it happens to work on.
   */
  catalog: CatalogMutations;
  /** Runs claim verification where the storage in use says it must run. */
  verification: VerificationRunner;
  /**
   * False until the repositories have attached their store. Until then every list reads empty,
   * which is indistinguishable from "no data" and would render false empty states (dossier
   * shows "System not found", catalog shows "0 systems"). Pages that can show an empty state
   * must gate on this.
   */
  attached: boolean;
  /**
   * True when claim verification runs on the server, against the whole archive (PostgreSQL). The
   * Autonomy page then asks the server to run it rather than running it over the browser's window.
   */
  verificationOnServer: boolean;
  /**
   * A blocking storage failure: the server or browser catalog could not be opened. The shell
   * replaces the page with an explanation instead of showing seed data as if it were the catalog.
   */
  storageError: string | null;
  /**
   * A non-blocking persistence problem: a write was rejected or a conflicting edit was reloaded.
   * The shell keeps the app usable but shows the warning so the failure is never silent.
   */
  storageWarning: string | null;
  clearStorageWarning(): void;
  /**
   * Explicit opt-in to a browser-only catalog after server storage failed. Never selected
   * automatically, because edits there would diverge from the server's copy.
   */
  continueInBrowser(): Promise<void>;
}

export const Ctx = createContext<Services | null>(null);
