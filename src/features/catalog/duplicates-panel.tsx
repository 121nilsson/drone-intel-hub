import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import type { duplicateGroups } from "@/entities/drone/duplicates";
import { useServices } from "@/shared/infra/services";
import { Select } from "@/shared/ui/fields";
import { Btn, Panel } from "@/shared/ui/primitives";

type DuplicateGroup = ReturnType<typeof duplicateGroups>[number];

/**
 * Possible duplicates and their merge controls. It sits in the results column, opened from the
 * banner above the list: a merge is a decision about the catalog, not a filter on it, and inside
 * the filter sidebar it was out of reach on a phone.
 */
export function DuplicatesPanel({ groups }: { groups: readonly DuplicateGroup[] }) {
  const svc = useServices();
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <Panel title={`Possible duplicates (${groups.length})`} contentClassName="p-0">
      <ul className="divide-y divide-border">
        {groups.map((dup) => {
          const target = targets[dup.key] || dup.ids[0] || "";
          const merge = () => {
            const toMerge = dup.ids.filter((x) => x !== target);
            for (const m of toMerge) svc.catalog.merge(target, m);
            setConfirming(null);
            setTargets(({ [dup.key]: _, ...rest }) => rest);
            toast("Duplicate systems merged", {
              description: `${toMerge.length} folded into ${target}`,
            });
          };
          return (
            <li key={dup.key} className="grid min-w-0 gap-3 p-4 md:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="min-w-0 text-sm">
                <p className="font-semibold">{dup.name}</p>
                <p className="text-xs text-muted-foreground">{dup.reasons.join("; ")}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  {dup.drones.map((d) => (
                    <Link
                      key={d.id}
                      to="/systems/$id"
                      params={{ id: d.id }}
                      className="font-mono text-2xs text-primary hover:underline"
                    >
                      {d.id}
                    </Link>
                  ))}
                </div>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Select
                  size="sm"
                  value={target}
                  onChange={(e) => setTargets((prev) => ({ ...prev, [dup.key]: e.target.value }))}
                  className="w-full"
                  aria-label={`System to keep for ${dup.name}`}
                >
                  {dup.drones.map((d) => (
                    <option key={d.id} value={d.id}>
                      Keep: {d.name} ({d.id})
                    </option>
                  ))}
                </Select>
                {confirming === dup.key ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">
                      Merge {dup.ids.length - 1} into {target}?
                    </span>
                    <Btn size="sm" onClick={merge}>
                      Confirm
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      Cancel
                    </Btn>
                  </div>
                ) : (
                  <Btn
                    size="sm"
                    variant="ghost"
                    className="w-full justify-center"
                    disabled={!target || dup.ids.length < 2}
                    onClick={() => setConfirming(dup.key)}
                  >
                    Merge {dup.ids.length - 1} into kept
                  </Btn>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
