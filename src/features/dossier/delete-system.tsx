import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Btn } from "@/shared/ui/primitives";
import { useServices } from "@/shared/infra/services";
import type { Drone } from "@/entities/drone/types";

/**
 * Delete a wrongly catalogued entry. Two steps: the first click shows what else the removal
 * touches, the second does it. See CatalogMutations.remove for what is cleaned up.
 */
export function DeleteSystem({ drone }: { drone: Drone }) {
  const svc = useServices();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <Btn variant="danger" onClick={() => setConfirming(true)}>
        Delete
      </Btn>
    );
  const impact = svc.catalog.removalImpact(drone.id);
  const effects = [
    impact.discarded &&
      `${impact.discarded} candidate${impact.discarded === 1 ? "" : "s"} marked discarded`,
    impact.unlinked &&
      `${impact.unlinked} linked system${impact.unlinked === 1 ? "" : "s"} unlinked`,
    impact.dispatches &&
      `${impact.dispatches} feed post${impact.dispatches === 1 ? "" : "s"} lose this link`,
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-2 border border-destructive/60 px-3 py-2 text-sm">
      <span>
        Delete <strong>{drone.name}</strong> and its {drone.specs.length} spec
        {drone.specs.length === 1 ? "" : "s"}?{effects.length ? ` ${effects.join(", ")}.` : ""} The
        name will not be auto-promoted again.
      </span>
      <Btn
        variant="danger"
        onClick={() => {
          svc.catalog.remove(drone.id);
          void navigate({ to: "/catalog" });
        }}
      >
        Confirm delete
      </Btn>
      <Btn variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Btn>
    </div>
  );
}
