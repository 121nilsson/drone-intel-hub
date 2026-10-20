import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Btn, Card, Panel, Tag } from "@/shared/ui/primitives";
import {
  fetchPendingFixtures,
  triggerDecideFixture,
} from "@/shared/infra/evaluation/evaluation.functions";
import type { PendingFixture } from "@/shared/infra/evaluation/evaluation.server";
import { TRUST_AGREEMENT, TRUST_MIN_REVIEWS } from "@/shared/infra/ingest/earned-trust";

type Listing = Awaited<ReturnType<typeof fetchPendingFixtures>>;

const pct = (n: number) => `${Math.round(n * 100)}%`;

const expectation = (e: { semantic: string; value: number | string; unit?: string }) =>
  `${e.semantic} = ${e.value}${e.unit ? ` ${e.unit}` : ""}`;

/**
 * Regression fixtures waiting for a person: today the positive ones AI adjudication proposes. The
 * sandbox ignores a fixture until it is approved, and each decision here is also what the
 * adjudicator earns the right to approve its own fixtures from.
 */
export function PendingFixturesPanel() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAuto, setShowAuto] = useState(false);

  const load = useCallback(() => {
    fetchPendingFixtures()
      .then(setListing)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  const decide = async (f: PendingFixture, approve: boolean) => {
    setBusy(f.id);
    try {
      const r = await triggerDecideFixture({ data: { id: f.id, version: f.version, approve } });
      if (!r.ok) toast.error("Already decided, or no database configured");
      load();
    } catch (e) {
      toast.error(`Could not save the decision: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  if (!listing) return null;
  const { trust, items, total, autoApproved, autoApprovedRecent } = listing;
  const n = trust.agreed + trust.disagreed;
  return (
    <Panel
      title={`Pending test cases · ${total}`}
      right={
        <Tag
          tone={
            trust.state === "earned" ? "success" : trust.state === "distrusted" ? "danger" : "muted"
          }
          mono
        >
          {trust.state === "earned" ? "auto-approving" : trust.state}
        </Tag>
      }
    >
      <p className="text-xs text-muted-foreground">
        {trust.state === "earned" ? (
          <>
            Auto-approved based on earned analyst trust ({trust.agreed}/{n} approved,{" "}
            {pct(trust.agreed / n)}). The adjudicator approves its own fixtures while at least{" "}
            {pct(TRUST_AGREEMENT)} of {TRUST_MIN_REVIEWS}+ decisions approve it, and hands them back
            if that falls.{" "}
            {autoApproved > 0 && (
              <>
                {autoApproved} auto-approved fixture{autoApproved !== 1 && "s"} can be{" "}
                <button type="button" className="underline" onClick={() => setShowAuto((v) => !v)}>
                  reviewed and revoked
                </button>
                .
              </>
            )}
          </>
        ) : (
          <>
            Requires analyst approval. Test cases from AI adjudication wait here until approved; the
            rule sandbox ignores them until then. Adjudication earns the right to approve its own
            once {pct(TRUST_AGREEMENT)} of at least {TRUST_MIN_REVIEWS} decisions here approve it.
            So far:{" "}
            {n
              ? `${trust.agreed} approved, ${trust.disagreed} rejected (${pct(trust.agreed / n)})`
              : "no decisions"}
            .
          </>
        )}
      </p>
      {showAuto && autoApprovedRecent.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Recently auto-approved ({autoApproved} total) — reject to revoke:
          </p>
          {autoApprovedRecent.map((f) => (
            <Card key={`auto-${f.id}|${f.version}`} className="space-y-2 text-xs opacity-80">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Tag mono tone="success">
                  auto
                </Tag>
                <span className="min-w-0 truncate font-mono text-muted-foreground">
                  {f.fixture.source}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words">{f.fixture.text.slice(0, 400)}</p>
              <p className="font-mono text-primary">
                {f.fixture.expect.map(expectation).join(" · ") || "—"}
              </p>
              <Btn
                variant="ghost"
                className="px-2 py-1 text-xs"
                disabled={busy === f.id}
                onClick={() => void decide(f, false)}
              >
                Revoke
              </Btn>
            </Card>
          ))}
        </div>
      )}
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing waiting.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map((f) => (
            <Card key={`${f.id}|${f.version}`} className="space-y-2 text-xs">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Tag mono>{f.origin}</Tag>
                <span className="min-w-0 truncate font-mono text-muted-foreground">
                  {f.fixture.source}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words">{f.fixture.text.slice(0, 400)}</p>
              <p className="font-mono text-primary">
                {f.fixture.expect.map(expectation).join(" · ") || "—"}
                {f.fixture.forbid?.length
                  ? ` · must not: ${f.fixture.forbid.map((x) => expectation({ ...x, value: x.value ?? "*" })).join(" · ")}`
                  : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <Btn
                  className="px-2 py-1 text-xs"
                  disabled={busy === f.id}
                  onClick={() => void decide(f, true)}
                >
                  Approve
                </Btn>
                <Btn
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  disabled={busy === f.id}
                  onClick={() => void decide(f, false)}
                >
                  Reject
                </Btn>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Panel>
  );
}
