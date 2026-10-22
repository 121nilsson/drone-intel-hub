import type { Drone } from "@/entities/drone/types";
import type { Procurement } from "@/entities/procurement/types";
import { procurementDay, procurementSystemRefs } from "@/entities/procurement/presentation";
import { CountryBadge } from "@/shared/ui/country-badge";
import { SourceRef, SystemChip } from "@/shared/ui/links";
import { Tag } from "@/shared/ui/primitives";
import { cn } from "@/lib/utils";

/**
 * One contract, as the procurement table's mobile card and the dossier's contracts panel show it.
 * The desktop table uses cells, but every field comes from the same presentation helpers so the
 * two views cannot disagree about a date or a system link.
 */
export function ContractRow({
  contract,
  drones = [],
  showNotes = false,
  className,
}: {
  contract: Procurement;
  /** Used to link a stored system id to its dossier; absent ids still show the stored name. */
  drones?: readonly Drone[];
  showNotes?: boolean;
  className?: string;
}) {
  const systems = procurementSystemRefs(contract, drones);
  return (
    <article className={cn("min-w-0 space-y-2", className)} data-testid="contract-row">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="break-words font-medium">{contract.company}</p>
          <p className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-muted-foreground">
            {contract.country ? <CountryBadge code={contract.country} /> : "Country unknown"}
            <span>· {procurementDay(contract)}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm text-primary">
            {contract.amount ?? "Amount unknown"}
          </span>
          {contract.currency && <Tag>{contract.currency}</Tag>}
        </div>
      </div>
      {(contract.customer || contract.program) && (
        <div className="flex flex-wrap gap-1.5">
          {contract.customer && (
            <Tag tone="accent" caps={false} mono={false}>
              Buyer: {contract.customer}
            </Tag>
          )}
          {contract.program && (
            <Tag caps={false} mono={false}>
              {contract.program}
            </Tag>
          )}
        </div>
      )}
      {systems.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {systems.map((system, i) =>
            system.id ? (
              <SystemChip key={`${system.id}-${i}`} id={system.id} name={system.name} />
            ) : (
              <Tag key={`${system.name}-${i}`} caps={false} mono={false}>
                {system.name}
              </Tag>
            ),
          )}
        </div>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted-foreground">
        <SourceRef source={contract.source} href={contract.sourceUrl} className="max-w-full" />
      </div>
      {showNotes && contract.notes && (
        <p className="break-words text-xs leading-relaxed text-muted-foreground">
          {contract.notes}
        </p>
      )}
    </article>
  );
}
