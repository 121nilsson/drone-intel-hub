import { useState } from "react";
import { toast } from "sonner";
import type { Drone } from "@/entities/drone/types";
import { originProposal, originTally, UNKNOWN_ORIGIN } from "@/entities/drone/origin-audit";
import { countryCode } from "@/entities/normalization/country";
import { useServices } from "@/shared/infra/use-services";
import { CountryBadge } from "@/shared/ui/country-badge";
import { Input } from "@/shared/ui/fields";
import { Btn, Tag } from "@/shared/ui/primitives";

/**
 * The entry's country of origin, with what the reports say about it. The stored origin was set
 * by the first report; a later majority that disagrees is shown as a proposal for the analyst to
 * accept or keep, and the analyst can correct the origin outright. Either way the decision is
 * recorded (origin-audit.ts), and a country turned down is not proposed again.
 */
export function OriginControl({ drone }: { drone: Drone }) {
  const svc = useServices();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const proposal = originProposal(drone);
  const tally = originTally(drone);

  const set = (origin: string, done: string) => {
    const code = countryCode(origin);
    if (!/^[A-Z]{2}$/.test(code)) {
      toast.error(`"${origin}" is not a country code or name the catalogue knows`);
      return;
    }
    svc.catalog.setOrigin(drone.id, code);
    toast.success(done);
    setEditing(false);
  };

  const reports = tally.map((t) => `${t.country} ${t.count}`).join(" · ");

  return (
    <>
      <Tag caps={false} mono={false}>
        Origin{" "}
        {drone.origin && drone.origin !== UNKNOWN_ORIGIN ? (
          <CountryBadge code={drone.origin} />
        ) : (
          "unknown"
        )}
        {drone.originReview && <span className="ml-1 text-muted-foreground">(set by analyst)</span>}
      </Tag>
      <Btn
        size="sm"
        variant="ghost"
        onClick={() => {
          setValue(drone.origin === UNKNOWN_ORIGIN ? "" : drone.origin);
          setEditing((e) => !e);
        }}
      >
        {editing ? "Cancel" : "Edit origin"}
      </Btn>
      {editing && (
        <form
          className="flex w-full flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            set(value, "Origin set");
          }}
        >
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Country code or name, e.g. US or United States"
            className="w-64 max-w-full"
          />
          <Btn type="submit" size="sm">
            Set origin
          </Btn>
          {reports && <span className="text-xs text-muted-foreground">Reports: {reports}</span>}
        </form>
      )}
      {proposal && !editing && (
        <div className="flex w-full flex-wrap items-center gap-2 rounded border border-border p-2 text-sm">
          <span>
            {proposal.support} of {proposal.total} reports give the origin as{" "}
            <CountryBadge code={proposal.country} />
            {proposal.kind === "change" ? (
              <>
                , not <CountryBadge code={drone.origin} />.
              </>
            ) : (
              "."
            )}
          </span>
          <Btn size="sm" onClick={() => set(proposal.country, `Origin set to ${proposal.country}`)}>
            Set origin to {proposal.country}
          </Btn>
          {proposal.kind === "change" && (
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => set(drone.origin, `Origin kept as ${drone.origin}`)}
            >
              Keep {drone.origin}
            </Btn>
          )}
        </div>
      )}
    </>
  );
}
