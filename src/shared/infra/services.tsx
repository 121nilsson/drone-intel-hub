import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { backfillCatalogue } from "./verification/backfill";
import { runCatalogueVerification } from "./verification/run";
import {
  fetchTokenUsage,
  triggerEntailment,
  triggerServerVerification,
} from "./verification/verification.functions";
import { recordVerificationRun } from "./autonomy/autonomy.functions";
import type { VerificationRunner } from "@/shared/contracts/verification";
import { Ctx, type Services, type SeedSnapshots } from "./services-context";
import { useStoreRefresh } from "./use-store-refresh";

export { DEFAULT_SETTINGS } from "./settings-defaults";
import { DEFAULT_SETTINGS } from "./settings-defaults";

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
  const [seed] = useState<SeedSnapshots>(() => ({
    drones: drones.list(),
    candidates: candidates.list(),
    sources: sources.list(),
    dispatches: dispatches.list(),
    procurements: procurements.list(),
    taxonomies: taxonomies.terms(),
    taxonomyCandidates: taxonomyCandidates.list(),
  }));
  const [envCfg, setEnvCfg] = useState<EnvProviderConfig | null>(null);
  const [attached, setAttached] = useState(false);
  const [verificationOnServer, setVerificationOnServer] = useState(false);
  /** The catalogue lives on the server, where other tabs, the sync and the verifier change it. */
  const [sharedStore, setSharedStore] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  const repos = useMemo(
    () => [drones, candidates, sources, dispatches, procurements, taxonomies, taxonomyCandidates],
    [drones, candidates, sources, dispatches, procurements, taxonomies, taxonomyCandidates],
  );

  // The small collections only; see use-store-refresh.ts for why dispatches and sources are not here.
  const refreshed = useMemo(
    () => [drones, candidates, procurements, taxonomies, taxonomyCandidates],
    [drones, candidates, procurements, taxonomies, taxonomyCandidates],
  );
  useStoreRefresh(refreshed, attached && sharedStore);

  /**
   * Verify stored claims once the catalogue is attached, so an entry ingested before the verifier
   * existed still gets a verdict. Idempotent (see backfill.ts), so a re-attach rewrites nothing.
   *
   * Only in browser storage. With PostgreSQL the server runs it (tasks/verification/run.ts),
   * because the browser holds only the newest posts and would judge every claim from an older one
   * "not in the archive". Against a last-write-wins store (Lovable Cloud) an unattended rewrite
   * could replace an analyst's concurrent edit, so there the run stays a deliberate action on
   * the Autonomy page.
   * A failure never breaks startup, but it is shown, not just logged.
   */
  const backfillVerification = useCallback(
    (revisions: boolean) => {
      if (!revisions) return;
      // Not awaited: it yields between chunks and must not hold up the attached UI.
      backfillCatalogue({ drones, dispatches }).catch((e: unknown) => {
        console.error("[verification] backfill failed", e);
        setStorageWarning(`Stored claims could not be re-verified (${reason(e)}).`);
      });
    },
    [drones, dispatches],
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
      setSharedStore(false);
      setStorageWarning(
        "Using browser storage. Changes are saved in this browser and are not synced to the server.",
      );
      // Browser storage enforces revisions. After the warning, so a backfill failure replaces it.
      backfillVerification(true);
    } catch (e) {
      setStorageError(`Browser storage could not be opened (${reason(e)}).`);
    }
  }, [repos, backfillVerification]);

  // Settings used to be typed into the browser and kept here, API key included. They no longer
  // are, so a leftover copy is removed rather than left behind in storage.
  useEffect(() => {
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch {
      /* storage unavailable */
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
      let revisions = true;
      try {
        const status = await getStoreStatus();
        if (cancelled) return;
        setEnvCfg(status.provider ?? null);
        server = status.postgres;
        revisions = status.revisions;
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
        setVerificationOnServer(server && revisions);
        setSharedStore(server);
        if (!server) backfillVerification(revisions);
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
  }, [repos, backfillVerification]);

  // The catalog operations are bound to the repository instances, not to a snapshot of their
  // contents: the instances are stable for the provider's life, and they read through to
  // whatever store they are attached to.
  const catalog = useMemo<CatalogMutations>(
    () => createCatalogMutations({ drones, candidates, dispatches }),
    [drones, candidates, dispatches],
  );

  /**
   * Where verification runs follows the storage: on the server over the whole archive with
   * PostgreSQL, otherwise in the browser over its own store. After a server run the catalogue is
   * reloaded so the page shows the stored verdicts - but only once this tab's queued writes have
   * landed, before and after: reload() adopts the server's revisions, and a write still queued
   * then would carry the new revision and quietly put back the copy the run had just verified.
   */
  const verification = useMemo<VerificationRunner>(
    () => ({
      run: async () => {
        if (!verificationOnServer)
          return await runCatalogueVerification({ drones, dispatches }, async (run) => {
            await recordVerificationRun({ data: run });
          });
        await drones.flush();
        const report = await triggerServerVerification();
        await drones.flush();
        await drones.reload();
        return report;
      },
      // Server-only, so there is no browser branch; the same flush-reload guard as above.
      runSecondReader: async () => {
        if (!verificationOnServer)
          throw new Error("The second reader runs on the server and needs its database.");
        await drones.flush();
        const result = await triggerEntailment();
        await drones.flush();
        await drones.reload();
        return result;
      },
      tokenUsageToday: async () => (verificationOnServer ? await fetchTokenUsage() : null),
    }),
    [verificationOnServer, drones, dispatches],
  );

  const value = useMemo<Services>(() => {
    // Env wins per-field; anything it doesn't define falls back to saved/built-in settings.
    // apiKey is blanked when the env supplies one so the key never enters the browser.
    const resolved: AIProviderSettings = {
      ...DEFAULT_SETTINGS,
      baseUrl: envCfg?.baseUrl ?? DEFAULT_SETTINGS.baseUrl,
      tier1Model: envCfg?.tier1Model ?? DEFAULT_SETTINGS.tier1Model,
      tier2Model: envCfg?.tier2Model ?? DEFAULT_SETTINGS.tier2Model,
      translateModel: envCfg?.translateModel ?? DEFAULT_SETTINGS.translateModel,
      apiKey: "",
    };
    const aiFromEnv = !!(
      envCfg?.hasKey ||
      envCfg?.baseUrl ||
      envCfg?.tier1Model ||
      envCfg?.tier2Model ||
      envCfg?.translateModel
    );
    const remote = envCfg?.hasKey === true;
    return {
      seed,
      drones,
      candidates,
      sources,
      dispatches,
      procurements,
      taxonomies,
      taxonomyCandidates,
      settings: resolved,
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
      verification,
      attached,
      verificationOnServer,
      storageError,
      storageWarning,
      clearStorageWarning: () => setStorageWarning(null),
      continueInBrowser,
    };
  }, [
    seed,
    drones,
    candidates,
    sources,
    dispatches,
    procurements,
    taxonomies,
    taxonomyCandidates,
    envCfg,
    verification,
    attached,
    verificationOnServer,
    storageError,
    storageWarning,
    continueInBrowser,
    catalog,
  ]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
