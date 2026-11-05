import { useContext, useSyncExternalStore } from "react";
import { Ctx } from "./services-context";

export type { Services } from "./services-context";

export function useServices() {
  const s = useContext(Ctx);
  if (!s) throw new Error("ServicesProvider missing");
  return s;
}

const never = () => () => {};

/**
 * False while this component hydrates, true after. A component that renders something only once
 * the store is attached must not do so during hydration: the server never attached, so its HTML
 * is the loading state, and a lazily loaded page can hydrate after the attach has finished.
 */
export function useHydrated() {
  return useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
}

/** Whether the repositories have attached their store, safe to render from during hydration. */
export function useAttached() {
  const { attached } = useServices();
  return useHydrated() && attached;
}

/*
 * Each list hook reads the live repository on the client and the seed snapshot while hydrating,
 * so the first client render equals the server's HTML whenever the page hydrates.
 */
export function useDrones() {
  const { drones, seed } = useServices();
  return useSyncExternalStore(
    (f) => drones.subscribe(f),
    () => drones.list(),
    () => seed.drones,
  );
}
export function useCandidates() {
  const { candidates, seed } = useServices();
  return useSyncExternalStore(
    (f) => candidates.subscribe(f),
    () => candidates.list(),
    () => seed.candidates,
  );
}
export function useSources() {
  const { sources, seed } = useServices();
  return useSyncExternalStore(
    (f) => sources.subscribe(f),
    () => sources.list(),
    () => seed.sources,
  );
}
export function useTaxonomies() {
  const { taxonomies, seed } = useServices();
  return useSyncExternalStore(
    (f) => taxonomies.subscribe(f),
    () => taxonomies.terms(),
    () => seed.taxonomies,
  );
}
export function useTaxonomyCandidates() {
  const { taxonomyCandidates, seed } = useServices();
  return useSyncExternalStore(
    (f) => taxonomyCandidates.subscribe(f),
    () => taxonomyCandidates.list(),
    () => seed.taxonomyCandidates,
  );
}
export function useDispatches() {
  const { dispatches, seed } = useServices();
  return useSyncExternalStore(
    (f) => dispatches.subscribe(f),
    () => dispatches.list(),
    () => seed.dispatches,
  );
}
export function useProcurementList() {
  const { procurements, seed } = useServices();
  return useSyncExternalStore(
    (f) => procurements.subscribe(f),
    () => procurements.list(),
    () => seed.procurements,
  );
}
