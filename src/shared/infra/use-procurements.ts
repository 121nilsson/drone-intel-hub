import { useSyncExternalStore } from "react";
import { useServices } from "./services";

/**
 * Procurement records subscribe on their own so the page and a dossier panel re-render only when
 * the contract collection changes; the service object itself is stable.
 */
export function useProcurements() {
  const { procurements } = useServices();
  return useSyncExternalStore(
    (f) => procurements.subscribe(f),
    () => procurements.list(),
    () => procurements.list(),
  );
}
