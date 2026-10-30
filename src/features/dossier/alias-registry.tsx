import { useMemo, useState } from "react";
import { Input, Select } from "@/shared/ui/fields";
import { Btn, ListRow, Panel, Tag } from "@/shared/ui/primitives";
import { SourceRef } from "@/shared/ui/links";
import { useServices } from "@/shared/infra/services";
import { aliasFold, isFamilyAlias, isGenericAlias } from "@/entities/drone/alias-policy";
import { buildConflictMap, conflictOwners } from "@/entities/drone/alias-claims";
import type { AliasClaim, Drone } from "@/entities/drone/types";

/**
 * The alias registry as an active workflow: intake suggestions arrive as candidates that
 * resolve nothing until an analyst approves them here, wrong aliases are rejected, and a name
 * that belongs to another entry is filed under that entry - which then answers to it. The flat
 * `drone.aliases` list is the derived, verified-only view; approving a candidate is what makes
 * a name resolvable everywhere, so the catalog-wide capture only ever changes by a decision.
 */

const KIND_LABELS: Record<NonNullable<AliasClaim["kind"]>, string> = {
  designation: "designation",
  reporting_name: "reporting name",
  transliteration: "transliteration",
  slang: "slang",
  legacy: "legacy",
};

/** "Outlet · https://…" provenance becomes label + link; anything else shows as text. */
function ClaimSource({ source }: { source: string }) {
  const m = source.match(/^(.+?)\s*·\s*(https?:\/\/\S+)$/);
  return m ? <SourceRef source={m[1]} href={m[2]} /> : <SourceRef source={source} />;
}

function AliasRow({
  claim,
  targets,
  conflictNames,
  family,
  onSetVerdict,
  onMove,
  onUndoMove,
}: {
  claim: AliasClaim;
  /** Other entries, for the "file under…" picker. */
  targets: { id: string; name: string }[];
  conflictNames: string[];
  /** The entry’s own designation without its variant letter ("F-35" on F-35A). */
  family: boolean;
  onSetVerdict: (claimId: string, verdict: "confirmed" | "rejected" | null) => void;
  onMove: (claimId: string, targetId: string) => void;
  onUndoMove: (claimId: string) => void;
}) {
  const [below, setBelow] = useState<"none" | "move">("none");
  const [target, setTarget] = useState("");
  const verified = claim.status === "verified";
  const candidate = claim.status === "candidate";
  const movedHere = claim.review?.verdict === "confirmed" && claim.review.movedFromDroneId;
  const undoable = Boolean(claim.review);

  const actions =
    candidate && !claim.review ? (
      <>
        <Btn size="sm" variant="primary" onClick={() => onSetVerdict(claim.id, "confirmed")}>
          Approve
        </Btn>
        <Btn size="sm" variant="ghost" onClick={() => onSetVerdict(claim.id, "rejected")}>
          Reject
        </Btn>
      </>
    ) : verified ? (
      <>
        <Btn size="sm" variant="ghost" onClick={() => setBelow(below === "move" ? "none" : "move")}>
          File under…
        </Btn>
        {undoable && (
          <Btn size="sm" variant="ghost" onClick={() => onSetVerdict(claim.id, null)}>
            Undo
          </Btn>
        )}
        <Btn size="sm" variant="ghost" onClick={() => onSetVerdict(claim.id, "rejected")}>
          Reject
        </Btn>
      </>
    ) : claim.review ? (
      claim.review.movedToDroneId ? (
        <Btn size="sm" variant="ghost" onClick={() => onUndoMove(claim.id)}>
          Return
        </Btn>
      ) : (
        <Btn size="sm" variant="ghost" onClick={() => onSetVerdict(claim.id, null)}>
          Undo
        </Btn>
      )
    ) : null;

  const verdictTag =
    verified && movedHere ? (
      <Tag tone="info">filed here</Tag>
    ) : verified ? (
      <Tag tone="success">verified</Tag>
    ) : candidate && !claim.review ? (
      <Tag tone="warning">candidate</Tag>
    ) : claim.review?.verdict === "rejected" ? (
      <Tag tone={claim.review.movedToDroneId ? "info" : "danger"}>
        {claim.review.movedToDroneId ? "filed elsewhere" : "rejected"}
      </Tag>
    ) : null;

  return (
    // Stacked on every width: a claim carries up to three chips and three buttons, which
    // crowded the alias off its own line and squeezed it to two characters instead.
    <ListRow
      stack
      title={
        <span className={claim.status === "rejected" ? "text-muted-foreground" : undefined}>
          {claim.alias}
        </span>
      }
      subtitle={
        claim.source || claim.evidence ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {claim.source ? <ClaimSource source={claim.source} /> : null}
            {claim.source && claim.evidence && (
              <span aria-hidden className="text-muted-foreground/60">
                ·
              </span>
            )}
            {claim.evidence && <span className="italic">{claim.evidence}</span>}
          </span>
        ) : undefined
      }
      meta={
        <>
          {verdictTag}
          {claim.kind && <Tag>{KIND_LABELS[claim.kind]}</Tag>}
          {conflictNames.length > 0 && (
            <Tag
              tone="accent"
              title={`Another entry also answers to this name: ${conflictNames.join(", ")}`}
            >
              shared with {conflictNames.length}
            </Tag>
          )}
          {family && (
            <Tag
              tone="warning"
              title="The designation without its variant letter names the whole family, so it also fits this entry’s siblings. It no longer resolves reports here."
            >
              family name
            </Tag>
          )}
        </>
      }
      actions={actions}
      below={
        below === "move" ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 border border-border bg-secondary/40 p-2">
            <Select
              size="sm"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label={`System to file ${claim.alias} under`}
              className="flex-1"
            >
              <option value="">File under another system…</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Btn
              variant="primary"
              disabled={!target}
              onClick={() => {
                onMove(claim.id, target);
                setTarget("");
                setBelow("none");
              }}
            >
              File
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => setBelow("none")}>
              Cancel
            </Btn>
          </div>
        ) : undefined
      }
    />
  );
}

export function AliasRegistry({ drone, catalog }: { drone: Drone; catalog: Drone[] }) {
  const svc = useServices();
  const claims = drone.aliasClaims ?? [];
  const [showRejected, setShowRejected] = useState(false);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const verified = claims.filter((c) => c.status === "verified");
  const candidates = claims.filter((c) => c.status === "candidate");
  const rejected = claims.filter((c) => c.status === "rejected");

  // Other entries, few and sorted: the whole move picker and the conflict names read from it.
  const others = useMemo(
    () =>
      catalog
        .filter((x) => x.id !== drone.id)
        .map((x) => ({ id: x.id, name: x.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [catalog, drone.id],
  );
  const nameById = useMemo(() => new Map(others.map((x) => [x.id, x.name])), [others]);
  // Read live as well as from the claim: a collision recorded at intake misses an entry that
  // gained the name later, and lists approved before the claim system carry no record at all.
  const conflicts = useMemo(() => buildConflictMap(catalog, drone.id), [catalog, drone.id]);
  const conflictNames = (claim: AliasClaim): string[] => {
    const ids = new Set(claim.conflictWithDroneIds ?? []);
    for (const o of conflictOwners(conflicts, aliasFold(claim.alias)) ?? []) ids.add(o.id);
    return [...ids].map((id) => nameById.get(id)).filter((n): n is string => Boolean(n));
  };
  const ownNames = [drone.name, drone.cyrillic];
  const isFamily = (claim: AliasClaim) => isFamilyAlias(claim.alias, ownNames);

  const generic = text.trim() !== "" && isGenericAlias(text);
  const familyText = text.trim() !== "" && isFamilyAlias(text, ownNames);
  const blocked = generic || familyText;

  const setVerdict = (claimId: string, verdict: "confirmed" | "rejected" | null) =>
    svc.catalog.reviewAlias(drone.id, claimId, verdict);
  const move = (claimId: string, targetId: string) =>
    svc.catalog.moveAlias(drone.id, claimId, targetId);
  const undo = (claimId: string) => svc.catalog.undoMoveAlias(drone.id, claimId);

  const add = () => {
    const alias = text.trim();
    if (!alias) return;
    const next = svc.catalog.addAlias(drone.id, alias);
    if (!next) {
      setError("Not registered: an alias needs a distinctive stem and its own name.");
      return;
    }
    setError(null);
    setText("");
    setAdding(false);
  };

  return (
    <Panel id="aliases" title="Alias registry" className="scroll-mt-28">
      <div className="space-y-3">
        <ul className="font-mono text-sm">
          <ListRow title={<span>{drone.name}</span>} meta={<Tag tone="primary">canonical</Tag>} />
          {drone.cyrillic && (
            <ListRow
              title={<span>{drone.cyrillic}</span>}
              meta={<Tag tone="primary">cyrillic</Tag>}
            />
          )}
          {!claims.length &&
            drone.aliases.map((a) => (
              <ListRow
                key={a}
                title={<span>{a}</span>}
                meta={<Tag tone="warning">legacy list</Tag>}
              />
            ))}
        </ul>

        {claims.length ? (
          <>
            {candidates.length > 0 && (
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                {candidates.length} awaiting review
              </p>
            )}
            <ul className="divide-y divide-border font-mono text-sm">
              {[...candidates, ...verified].map((claim) => (
                <AliasRow
                  key={claim.id}
                  claim={claim}
                  targets={others}
                  conflictNames={conflictNames(claim)}
                  family={isFamily(claim)}
                  onSetVerdict={setVerdict}
                  onMove={move}
                  onUndoMove={undo}
                />
              ))}
            </ul>
            {rejected.length > 0 && (
              <div>
                <Btn
                  size="sm"
                  variant="quiet"
                  className="-ml-2"
                  aria-expanded={showRejected}
                  onClick={() => setShowRejected((v) => !v)}
                >
                  {showRejected ? "Hide" : "Show"} rejected ({rejected.length})
                </Btn>
                {showRejected && (
                  <ul className="mt-2 divide-y divide-border font-mono text-sm">
                    {rejected.map((claim) => (
                      <AliasRow
                        key={claim.id}
                        claim={claim}
                        targets={others}
                        conflictNames={conflictNames(claim)}
                        family={isFamily(claim)}
                        onSetVerdict={setVerdict}
                        onMove={move}
                        onUndoMove={undo}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        ) : drone.aliases.length ? null : (
          <p className="text-xs text-muted-foreground">
            No alias claims yet. Suggestions from intake posts land here for review and resolve
            nothing until approved.
          </p>
        )}

        {adding ? (
          <div className="space-y-2">
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            {generic && (
              <p className="text-xs text-warning">
                A class phrase names a category of systems, not this entry.
              </p>
            )}
            {familyText && (
              <p className="text-xs text-warning">
                This is the family name without the variant letter - it fits every sibling of{" "}
                {drone.name} too. Put it on a parent entry instead.
              </p>
            )}
            <div className="flex min-w-0 flex-wrap gap-2">
              <Input
                autoFocus
                aria-label="New alias"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!blocked) add();
                  }
                  if (e.key === "Escape") {
                    setAdding(false);
                    setText("");
                    setError(null);
                  }
                }}
                placeholder="Official designation, reporting name…"
                className="w-auto flex-1 px-2 py-1 [overflow-wrap:anywhere]"
              />
              <Btn size="sm" variant="primary" disabled={!text.trim() || blocked} onClick={add}>
                Register
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Btn>
            </div>
          </div>
        ) : (
          <Btn size="sm" variant="ghost" onClick={() => setAdding(true)}>
            Add alias
          </Btn>
        )}
      </div>
    </Panel>
  );
}
