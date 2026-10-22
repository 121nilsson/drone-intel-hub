import type { Drone } from "@/entities/drone/types";
import type { Procurement } from "./types";

export interface ProcurementSystemRef {
  id?: string;
  name: string;
}

/**
 * The systems a contract names, resolved against the catalog when possible. `systemNames` keeps
 * names a match could not resolve, so the record never looks unattributed just because a system
 * is missing from the catalog.
 */
export function procurementSystemRefs(
  procurement: Procurement,
  drones: readonly Drone[] = [],
): ProcurementSystemRef[] {
  const names = procurement.systemNames ?? [];
  const ids = procurement.systemIds ?? [];
  const refs: ProcurementSystemRef[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const drone = drones.find((d) => d.id === id);
    if (!drone || seen.has(drone.id)) continue;
    seen.add(drone.id);
    refs.push({ id: drone.id, name: drone.name });
  }
  for (const name of names) {
    const drone = drones.find(
      (d) =>
        d.name.toLowerCase() === name.trim().toLowerCase() ||
        d.aliases.some((a) => a.toLowerCase() === name.trim().toLowerCase()),
    );
    if (drone) {
      if (seen.has(drone.id)) continue;
      seen.add(drone.id);
      refs.push({ id: drone.id, name: drone.name });
    } else {
      refs.push({ name });
    }
  }
  if (!refs.length && procurement.product) refs.push({ name: procurement.product });
  return refs;
}

/** Announcement date when the report gives one, otherwise when the record entered the catalog. */
export function procurementDate(procurement: Procurement): string {
  return procurement.announcedAt ?? procurement.createdAt;
}

/** Stable day for display; an unparseable date is shown as written instead of as "Invalid Date". */
export function procurementDay(procurement: Procurement): string {
  const raw = procurementDate(procurement);
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : raw.slice(0, 10);
}

/** The text a procurement search reads. Amounts are included so "$2 billion" finds a deal. */
export function procurementHaystack(procurement: Procurement): string {
  return [
    procurement.company,
    procurement.country,
    procurement.amount,
    procurement.currency,
    procurement.program,
    procurement.product,
    procurement.customer,
    procurement.source,
    procurement.notes,
    ...(procurement.systemNames ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
