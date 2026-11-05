import { Link } from "@tanstack/react-router";
import { Panel } from "@/shared/ui/primitives";
import { ContractRow } from "@/shared/ui/contracts";
import { type Drone } from "@/entities/drone/types";
import { contractsForDrone } from "@/entities/procurement/match";
import { useDrones } from "@/shared/infra/use-services";

export function ContractsPanel({
  drone: d,
  contracts,
  drones,
}: {
  drone: Drone;
  contracts: ReturnType<typeof contractsForDrone>;
  drones: ReturnType<typeof useDrones>;
}) {
  return (
    <Panel
      id="contracts"
      title="Contracts & procurement"
      className="scroll-mt-28"
      right={
        <Link
          to="/procurement"
          search={{ system: d.id }}
          className="font-mono text-xs text-primary hover:underline"
        >
          All contracts →
        </Link>
      }
    >
      {contracts.length ? (
        <ul className="space-y-3">
          {contracts.map((contract) => (
            <li key={contract.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
              <ContractRow contract={contract} drones={drones} showNotes />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No contract or production-deal records linked to this system yet.
        </p>
      )}
    </Panel>
  );
}
