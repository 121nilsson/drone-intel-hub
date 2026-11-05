import { attributeSemantic } from "@/entities/drone/spec-engine";
import { cleanReading, claimReading } from "@/entities/drone/claim-reading";
import type { Drone } from "@/entities/drone/types";
import type { AuditItem } from "@/shared/contracts/verification";
import { speedNatureLabel } from "./speed-nature";

export interface LiveReading {
  /** The catalogue's reading of the claim: qualifier, figure, unit ("up to 500 km"). */
  clean: string;
  /** What kind of speed the attribute is, for a speed claim. */
  nature?: string;
}

/**
 * The structured reading of an audited claim, from the claim as the catalogue holds it now.
 *
 * An audit row is a snapshot that keeps only the string the claim was drawn with, so the claim is
 * found again by system, attribute and that string. If it was edited or removed since, nothing is
 * returned and the row is shown as it was drawn: a reading of a different claim must never stand in
 * for the one being judged.
 */
export function liveReading(
  drones: readonly Drone[],
  item: Pick<AuditItem, "droneId" | "specLabel" | "value">,
): LiveReading | undefined {
  const drone = drones.find((d) => d.id === item.droneId);
  for (const spec of drone?.specs ?? []) {
    if (spec.label !== item.specLabel) continue;
    const claim = spec.claims.find((c) => claimReading(spec, c) === item.value);
    if (!claim) continue;
    const nature = speedNatureLabel(attributeSemantic(spec));
    return { clean: cleanReading(spec, claim), ...(nature ? { nature } : {}) };
  }
  return undefined;
}
