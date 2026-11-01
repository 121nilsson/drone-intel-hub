import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useDrones, useServices } from "@/shared/infra/services";
import type { TokenUsageToday } from "@/shared/contracts/verification";
import { Btn, Card, CardGrid, Panel, Tag } from "@/shared/ui/primitives";
import { Stat } from "./stat";

/**
 * The second reader (plan §4.3, step 5): what an independent model said about the claims the
 * deterministic checks left uncertain, and what it spent. Measured, not acted on - the panel says
 * so, because a verdict shown next to the claim states would otherwise read as one of them.
 */

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : `${n}`);

export function SecondReaderPanel() {
  const svc = useServices();
  const drones = useDrones();
  const [usage, setUsage] = useState<TokenUsageToday | null>(null);
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => {
    const c = { supported: 0, unsupported: 0, uncertain: 0 };
    for (const d of drones)
      for (const s of d.specs)
        for (const claim of s.claims) if (claim.entailment) c[claim.entailment.verdict]++;
    return c;
  }, [drones]);
  const read = counts.supported + counts.unsupported + counts.uncertain;

  const { verification } = svc;
  const loadUsage = useCallback(() => {
    verification
      .tokenUsageToday()
      .then(setUsage)
      .catch(() => {});
  }, [verification]);
  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await svc.verification.runSecondReader();
      if (r.ran)
        toast.success(
          `Read ${r.posts} post(s), ${r.claims} claim(s): ${r.supported} supported, ${r.unsupported} unsupported, ${r.uncertain} uncertain. ${r.deferred} post(s) left (${r.reason}).`,
        );
      else toast.message(`Not run: ${r.reason}.`);
      loadUsage();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Second reader"
      right={
        <div className="flex items-center gap-2">
          <Tag tone="muted" mono>
            measured only
          </Tag>
          {svc.verificationOnServer && (
            <Btn size="sm" onClick={run} disabled={busy}>
              {busy ? "Reading…" : "Run now"}
            </Btn>
          )}
        </div>
      }
    >
      <p className="text-xs text-muted-foreground">
        A model that extracted none of a post&apos;s claims reads the post and says, for each claim
        the checks above left uncertain, whether the post states it. It is not shown the
        extractor&apos;s quote, and it must point at the passage it relied on; a passage the post
        does not contain makes its answer uncertain. It runs hourly within the daily token ceiling.
        Its answers change no claim yet: first they are compared with your answers on the{" "}
        <Link to="/audit" className="underline">
          Audit
        </Link>{" "}
        page.
      </p>
      {!svc.verificationOnServer ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Runs on the server; this catalogue has no server database.
        </p>
      ) : (
        <CardGrid cols={3} className="mt-4">
          <Stat
            label="Read"
            value={`${read}`}
            hint={`${counts.supported} supported · ${counts.unsupported} unsupported · ${counts.uncertain} uncertain`}
          />
          <Stat
            label="Tokens today"
            value={usage ? `${k(usage.input)} / ${k(usage.ceiling.input)}` : "—"}
            hint="input, against the daily ceiling"
          />
          <Stat
            label="Output today"
            value={usage ? `${k(usage.output)} / ${k(usage.ceiling.output)}` : "—"}
            hint="a reasoning model's thinking counts here"
          />
        </CardGrid>
      )}
    </Panel>
  );
}
