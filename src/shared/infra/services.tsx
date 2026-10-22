import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  AIProviderSettings,
  BriefingSummarizer,
  IntelExtractor,
  ProcurementExtractor,
  ProviderEnvConfig,
} from "@/shared/contracts/ai";
import type { CatalogMutations } from "@/shared/contracts/catalog";
import {
  LocalCandidateRepository,
  LocalDispatchRepository,
  LocalDroneRepository,
  LocalProcurementRepository,
  LocalSourceRepository,
  LocalTaxonomyCandidateRepository,
  LocalTaxonomyRepository,
} from "./storage/local-repository";
import type { DocumentStore } from "@/shared/contracts/store";
import { LocalStorageStore } from "./storage/local-store";
import { RemoteStore } from "./storage/remote-store";
import { getStoreStatus } from "./storage/store.functions";
import { HeuristicExtractor, HeuristicSummarizer } from "./heuristic-ai";
import { OpenAICompatibleExtractor, OpenAICompatibleSummarizer } from "./openai-compatible-ai";
import { openAIProcurementExtractor } from "./procurement-extractor";
import { createCatalogMutations } from "./catalog-operations";

export { DEFAULT_SETTINGS } from "./settings-defaults";
import { DEFAULT_SETTINGS } from "./settings-defaults";

interface Services {
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
  /**
   * False until the repositories have attached their store. Until then every list reads empty,
   * which is indistinguishable from "no data" and would render false empty states (dossier
   * shows "System not found", catalog shows "0 systems"). Pages that can show an empty state
   * must gate on this.
   */
  attached: boolean;
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

const Ctx = createContext<Services | null>(null);
const SETTINGS_KEY = "dti.settings.v1";

/** Non-secret provider config from .env.local; null when the server has none. */
type EnvProviderConfig = ProviderEnvConfig;

/** One short line from a failed promise, safe to show in the shell. */
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Composition root: the only place concrete implementations are chosen. */
export function ServicesProvider({ children }: { children: ReactNode }) {
  const [drones] = useState(() => new LocalDroneRepository());
  const [candidates] = useState(() => new LocalCandidateRepository());
  const [sources] = useState(() => new LocalSourceRepository());
  const [dispatches] = useState(() => new LocalDispatchRepository());
  const [procurements] = useState(() => new LocalProcurementRepository());
  const [taxonomies] = useState(() => new LocalTaxonomyRepository());
  const [taxonomyCandidates] = useState(() => new LocalTaxonomyCandidateRepository());
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [envCfg, setEnvCfg] = useState<EnvProviderConfig | null>(null);
  const [attached, setAttached] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  const repos = useMemo(
    () => [drones, candidates, sources, dispatches, procurements, taxonomies, taxonomyCandidates],
    [drones, candidates, sources, dispatches, procurements, taxonomies, taxonomyCandidates],
  );

  /**
   * The explicit escape hatch from a failed server catalog. It is never chosen automatically:
   * silently continuing on localStorage would give the analyst a second, unsynced catalog.
   */
  const continueInBrowser = useCallback(async () => {
    setStorageError(null);
    setStorageWarning(null);
    try {
      const local = new LocalStorageStore();
      const results = await Promise.allSettled(repos.map((repo) => repo.attach(local)));
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failure) {
        setStorageError(`Browser storage could not be opened (${reason(failure.reason)}).`);
        return;
      }
      setAttached(true);
      setStorageWarning(
        "Using browser storage. Changes are saved in this browser and are not synced to the server.",
      );
    } catch (e) {
      setStorageError(`Browser storage could not be opened (${reason(e)}).`);
    }
  }, [repos]);

  useEffect(() => {
    try {
      const s = localStorage.getItem(SETTINGS_KEY);
      if (s) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(s) });
    } catch {
      /* ignore */
    }
  }, []);

  // Write failures and dropped conflicting edits are reported by the repositories. Keeping the
  // subscription outside the attach effect means a failure after startup stays visible.
  useEffect(() => {
    const offs = repos.map((repo) => repo.onStorageError((message) => setStorageWarning(message)));
    return () => offs.forEach((off) => off());
  }, [repos]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Storage selection: PostgreSQL when the server has DATABASE_URL (or Cloud), otherwise
      // this browser. A status call that fails is not evidence that there is no server storage,
      // so it must not fall back silently - the error path asks the analyst to retry.
      let store: DocumentStore;
      let server = false;
      try {
        const status = await getStoreStatus();
        if (cancelled) return;
        setEnvCfg(status.provider ?? null);
        server = status.postgres;
        store = server ? new RemoteStore() : new LocalStorageStore();
      } catch (e) {
        if (cancelled) return;
        setEnvCfg(null);
        setStorageError(
          `The storage service could not be reached (${reason(e)}). Reload to try again, or continue in this browser.`,
        );
        return;
      }

      try {
        const results = await Promise.allSettled(repos.map((repo) => repo.attach(store)));
        if (cancelled) return;
        const failure = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (failure) {
          // No automatic local fallback. Wait for every attach to settle first, so the explicit
          // browser choice below cannot race a still-running server attach. Some repositories
          // may have opened the server catalog; continuing in the browser is a deliberate,
          // warned choice made from the error screen.
          setStorageError(
            `The ${server ? "server" : "browser"} catalog could not be opened (${reason(
              failure.reason,
            )}). Reload to try again${server ? ", or continue in this browser." : "."}`,
          );
          return;
        }
        setAttached(true);
      } catch (e) {
        if (cancelled) return;
        setStorageError(
          `The ${server ? "server" : "browser"} catalog could not be opened (${reason(e)}). Reload to try again${
            server ? ", or continue in this browser." : "."
          }`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repos]);

  // The catalog operations are bound to the repository instances, not to a snapshot of their
  // contents: the instances are stable for the provider's life, and they read through to
  // whatever store they are attached to.
  const catalog = useMemo<CatalogMutations>(
    () => createCatalogMutations({ drones, candidates, dispatches }),
    [drones, candidates, dispatches],
  );

  const value = useMemo<Services>(() => {
    // Env wins per-field; anything it doesn't define falls back to saved/built-in settings.
    // apiKey is blanked when the env supplies one so the key never enters the browser.
    const resolved: AIProviderSettings = {
      ...settings,
      baseUrl: envCfg?.baseUrl ?? settings.baseUrl,
      tier1Model: envCfg?.tier1Model ?? settings.tier1Model,
      tier2Model: envCfg?.tier2Model ?? settings.tier2Model,
      translateModel: envCfg?.translateModel ?? settings.translateModel,
      apiKey: envCfg?.hasKey ? "" : settings.apiKey,
    };
    const aiFromEnv = !!(
      envCfg?.hasKey ||
      envCfg?.baseUrl ||
      envCfg?.tier1Model ||
      envCfg?.tier2Model ||
      envCfg?.translateModel
    );
    const remote = envCfg?.hasKey === true || !!settings.apiKey;
    return {
      drones,
      candidates,
      sources,
      dispatches,
      procurements,
      taxonomies,
      taxonomyCandidates,
      settings: resolved,
      // When the env supplies the key, `s.apiKey` arrives blanked. Keep whatever this
      // browser had stored so clearing NVIDIA_API_KEY later doesn't silently lose it.
      saveSettings: (s) => {
        const next: AIProviderSettings = {
          ...s,
          apiKey: envCfg?.hasKey && !s.apiKey ? settings.apiKey : s.apiKey,
        };
        setSettings(next);
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      },
      aiConfigured: remote,
      aiKeyFromEnv: envCfg?.hasKey === true,
      aiFromEnv,
      providerEnv: envCfg,
      tier1: remote ? new OpenAICompatibleExtractor(1, resolved) : new HeuristicExtractor(1),
      tier2: remote ? new OpenAICompatibleExtractor(2, resolved) : new HeuristicExtractor(2),
      heuristic: new HeuristicExtractor(1),
      fallback: new HeuristicExtractor(1),
      summarizer: remote ? new OpenAICompatibleSummarizer(resolved) : new HeuristicSummarizer(),
      ...(remote
        ? {
            procurementExtractor: openAIProcurementExtractor({
              baseUrl: resolved.baseUrl,
              apiKey: resolved.apiKey,
              model: resolved.tier2Model,
            }),
          }
        : {}),
      catalog,
      attached,
      storageError,
      storageWarning,
      clearStorageWarning: () => setStorageWarning(null),
      continueInBrowser,
    };
  }, [
    drones,
    candidates,
    sources,
    dispatches,
    procurements,
    taxonomies,
    taxonomyCandidates,
    settings,
    envCfg,
    attached,
    storageError,
    storageWarning,
    continueInBrowser,
    catalog,
  ]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useServices() {
  const s = useContext(Ctx);
  if (!s) throw new Error("ServicesProvider missing");
  return s;
}

export function useDrones() {
  const { drones } = useServices();
  return useSyncExternalStore(
    (f) => drones.subscribe(f),
    () => drones.list(),
    () => drones.list(),
  );
}
export function useCandidates() {
  const { candidates } = useServices();
  return useSyncExternalStore(
    (f) => candidates.subscribe(f),
    () => candidates.list(),
    () => candidates.list(),
  );
}
export function useSources() {
  const { sources } = useServices();
  return useSyncExternalStore(
    (f) => sources.subscribe(f),
    () => sources.list(),
    () => sources.list(),
  );
}
export function useTaxonomies() {
  const { taxonomies } = useServices();
  return useSyncExternalStore(
    (f) => taxonomies.subscribe(f),
    () => taxonomies.terms(),
    () => taxonomies.terms(),
  );
}
export function useTaxonomyCandidates() {
  const { taxonomyCandidates } = useServices();
  return useSyncExternalStore(
    (f) => taxonomyCandidates.subscribe(f),
    () => taxonomyCandidates.list(),
    () => taxonomyCandidates.list(),
  );
}
export function useDispatches() {
  const { dispatches } = useServices();
  return useSyncExternalStore(
    (f) => dispatches.subscribe(f),
    () => dispatches.list(),
    () => dispatches.list(),
  );
}
