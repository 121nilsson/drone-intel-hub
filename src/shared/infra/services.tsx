import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AIProviderSettings, BriefingSummarizer, IntelExtractor } from "@/shared/contracts/ai";
import { LocalCandidateRepository, LocalDroneRepository, LocalSourceRepository } from "./local-repository";
import type { DocumentStore } from "@/shared/contracts/store";
import { LocalStorageStore } from "./local-store";
import { RemoteStore } from "./remote-store";
import { getStoreStatus } from "./store.functions";
import { HeuristicExtractor, HeuristicSummarizer } from "./heuristic-ai";
import { OpenAICompatibleExtractor, OpenAICompatibleSummarizer } from "./openai-compatible-ai";

export const DEFAULT_SETTINGS: AIProviderSettings = {
  baseUrl: "https://integrate.api.nvidia.com/v1",
  apiKey: "",
  tier1Model: "meta/llama-3.1-8b-instruct",
  tier2Model: "deepseek-ai/deepseek-r1",
  escalationThreshold: 0.6,
  autoMergeThreshold: 0.85,
};

interface Services {
  drones: LocalDroneRepository;
  candidates: LocalCandidateRepository;
  sources: LocalSourceRepository;
  settings: AIProviderSettings;
  saveSettings(s: AIProviderSettings): void;
  tier1: IntelExtractor;
  tier2: IntelExtractor;
  summarizer: BriefingSummarizer;
}

const Ctx = createContext<Services | null>(null);
const SETTINGS_KEY = "dti.settings.v1";

/** Composition root: the only place concrete implementations are chosen. */
export function ServicesProvider({ children }: { children: ReactNode }) {
  const [drones] = useState(() => new LocalDroneRepository());
  const [candidates] = useState(() => new LocalCandidateRepository());
  const [sources] = useState(() => new LocalSourceRepository());
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  useEffect(() => {
    try { const s = localStorage.getItem(SETTINGS_KEY); if (s) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(s) }); } catch { /* ignore */ }
    // Storage selection: PostgreSQL when the server has DATABASE_URL, otherwise this browser.
    (async () => {
      let store: DocumentStore = new LocalStorageStore();
      try { if ((await getStoreStatus()).postgres) store = new RemoteStore(); } catch { /* offline → local */ }
      try { await Promise.all([drones.attach(store), candidates.attach(store), sources.attach(store)]); }
      catch (e) {
        console.error("[store] remote unavailable, falling back to browser storage", e);
        const local = new LocalStorageStore();
        await Promise.all([drones.attach(local), candidates.attach(local), sources.attach(local)]);
      }
    })();
  }, [drones, candidates, sources]);

  const value = useMemo<Services>(() => {
    const remote = !!settings.apiKey;
    return {
      drones, candidates, sources, settings,
      saveSettings: (s) => { setSettings(s); localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); },
      tier1: remote ? new OpenAICompatibleExtractor(1, settings) : new HeuristicExtractor(1),
      tier2: remote ? new OpenAICompatibleExtractor(2, settings) : new HeuristicExtractor(2),
      summarizer: remote ? new OpenAICompatibleSummarizer(settings) : new HeuristicSummarizer(),
    };
  }, [drones, candidates, sources, settings]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useServices() {
  const s = useContext(Ctx);
  if (!s) throw new Error("ServicesProvider missing");
  return s;
}

export function useDrones() {
  const { drones } = useServices();
  return useSyncExternalStore((f) => drones.subscribe(f), () => drones.list(), () => drones.list());
}
export function useCandidates() {
  const { candidates } = useServices();
  return useSyncExternalStore((f) => candidates.subscribe(f), () => candidates.list(), () => candidates.list());
}
export function useSources() {
  const { sources } = useServices();
  return useSyncExternalStore((f) => sources.subscribe(f), () => sources.list(), () => sources.list());
}
