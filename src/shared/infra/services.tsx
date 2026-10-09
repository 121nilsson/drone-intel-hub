import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AIProviderSettings, BriefingSummarizer, IntelExtractor } from "@/shared/contracts/ai";
import {
  LocalCandidateRepository,
  LocalDispatchRepository,
  LocalDroneRepository,
  LocalProcurementRepository,
  LocalSourceRepository,
  LocalTaxonomyCandidateRepository,
  LocalTaxonomyRepository,
} from "./local-repository";
import type { DocumentStore } from "@/shared/contracts/store";
import { LocalStorageStore } from "./local-store";
import { RemoteStore } from "./remote-store";
import { getStoreStatus } from "./store.functions";
import type { ProviderEnvConfig } from "@/shared/contracts/ai";
import { HeuristicExtractor, HeuristicSummarizer } from "./heuristic-ai";
import { OpenAICompatibleExtractor, OpenAICompatibleSummarizer } from "./openai-compatible-ai";

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
  tier1: IntelExtractor;
  tier2: IntelExtractor;
  /** Built-in heuristic engine the pipeline degrades to when an AI tier throws. */
  fallback: IntelExtractor;
  summarizer: BriefingSummarizer;
}

const Ctx = createContext<Services | null>(null);
const SETTINGS_KEY = "dti.settings.v1";

/** Non-secret provider config from .env.local; null when the server has none. */
type EnvProviderConfig = ProviderEnvConfig;

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
  useEffect(() => {
    try {
      const s = localStorage.getItem(SETTINGS_KEY);
      if (s) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(s) });
    } catch {
      /* ignore */
    }
    // Storage selection: PostgreSQL when the server has DATABASE_URL, otherwise this browser.
    (async () => {
      let store: DocumentStore = new LocalStorageStore();
      try {
        const status = await getStoreStatus();
        setEnvCfg(status.provider);
        if (status.postgres) store = new RemoteStore();
      } catch {
        setEnvCfg(null);
      }
      try {
        await Promise.all([
          drones.attach(store),
          candidates.attach(store),
          sources.attach(store),
          dispatches.attach(store),
          procurements.attach(store),
          taxonomies.attach(store),
          taxonomyCandidates.attach(store),
        ]);
      } catch (e) {
        console.error("[store] remote unavailable, falling back to browser storage", e);
        const local = new LocalStorageStore();
        await Promise.all([
          drones.attach(local),
          candidates.attach(local),
          sources.attach(local),
          dispatches.attach(local),
          procurements.attach(local),
          taxonomies.attach(local),
          taxonomyCandidates.attach(local),
        ]);
      }
    })();
  }, [drones, candidates, sources, dispatches, procurements, taxonomies, taxonomyCandidates]);

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
      tier1: remote ? new OpenAICompatibleExtractor(1, resolved) : new HeuristicExtractor(1),
      tier2: remote ? new OpenAICompatibleExtractor(2, resolved) : new HeuristicExtractor(2),
      fallback: new HeuristicExtractor(1),
      summarizer: remote ? new OpenAICompatibleSummarizer(resolved) : new HeuristicSummarizer(),
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
