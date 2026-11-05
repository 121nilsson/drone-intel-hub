import { useProcurementList } from "./use-services";

/**
 * Procurement records subscribe on their own so the page and a dossier panel re-render only when
 * the contract collection changes; the service object itself is stable.
 */
export const useProcurements = useProcurementList;
