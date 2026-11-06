import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { AliasClaim, Drone } from "@/entities/drone/types";
import { claimKey } from "@/entities/drone/claim-review";
import { splitSuggestion } from "@/entities/drone/variant-split";
import { useServices } from "@/shared/infra/use-services";
import { Btn } from "@/shared/ui/primitives";

/**
 * Split a variant this entry has been carrying into an entry of its own, named by one alias.
 * The other aliases and the claims whose quote uses the variant's distinguishing words come
 * preselected; the analyst unticks what does not belong. Every move is the ordinary one, so a
 * claim or alias moved by mistake is returned from the new entry like any other.
 */
export function VariantSplitPanel({
  drone,
  claim,
  onClose,
}: {
  drone: Drone;
  claim: AliasClaim;
  onClose: () => void;
}) {
  const svc = useServices();
  const navigate = useNavigate();
  const suggestion = useMemo(() => splitSuggestion(drone, claim.id), [drone, claim.id]);
  const [aliasIds, setAliasIds] = useState(() => new Set(suggestion.aliasIds));
  const [claimKeys, setClaimKeys] = useState(
    () => new Set(suggestion.claims.map((c) => claimKey(c.claim))),
  );
  const aliases = (drone.aliasClaims ?? []).filter(
    (c) => c.id !== claim.id && c.status !== "rejected" && !c.review?.moveId,
  );
  const labelOf = new Map(drone.specs.map((s) => [s.key, s.label]));

  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };

  const split = () => {
    const created = svc.catalog.splitVariant(
      drone.id,
      [claim.id, ...aliases.filter((a) => aliasIds.has(a.id)).map((a) => a.id)],
      suggestion.claims.filter((c) => claimKeys.has(claimKey(c.claim))),
    );
    if (!created) {
      toast.error("Not split: the entry or the alias has changed. Reload and try again.");
      return;
    }
    toast.success(`${created.name} is now its own entry, a variant of ${drone.name}`);
    onClose();
    void navigate({ to: "/systems/$id", params: { id: created.id } });
  };

  return (
    <div className="space-y-3 border border-border bg-secondary/40 p-3 font-sans text-sm">
      <p>
        Make <strong>{claim.alias}</strong> its own entry, a variant of {drone.name}. What is ticked
        moves with it and stays here as moved, so it can be returned.
      </p>
      {aliases.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-xs uppercase tracking-widest text-muted-foreground">
            Aliases
          </legend>
          {aliases.map((a) => (
            <label key={a.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={aliasIds.has(a.id)}
                onChange={(e) => setAliasIds((s) => toggle(s, a.id, e.target.checked))}
              />
              {a.alias}
            </label>
          ))}
        </fieldset>
      )}
      <fieldset className="space-y-1">
        <legend className="text-xs uppercase tracking-widest text-muted-foreground">
          Claims whose quote names {claim.alias}
        </legend>
        {suggestion.claims.length ? (
          suggestion.claims.map(({ specKey, claim: c }) => {
            const key = claimKey(c);
            return (
              <label key={`${specKey}:${key}`} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={claimKeys.has(key)}
                  onChange={(e) => setClaimKeys((s) => toggle(s, key, e.target.checked))}
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="font-medium">{labelOf.get(specKey) ?? specKey}</span>:{" "}
                  {String(c.value)}
                  {c.evidence && (
                    <span className="block text-xs italic text-muted-foreground">{c.evidence}</span>
                  )}
                </span>
              </label>
            );
          })
        ) : (
          <p className="text-xs text-muted-foreground">
            None found. Claims can be moved one by one afterwards.
          </p>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Btn size="sm" variant="primary" onClick={split}>
          Split into {claim.alias}
        </Btn>
        <Btn size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Btn>
      </div>
    </div>
  );
}
