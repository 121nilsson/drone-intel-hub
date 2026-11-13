import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useServices } from "@/shared/infra/use-services";
import {
  answerAuditItem,
  disputeAuditControl,
  drawAuditBatch,
  drawAuditFirstSession,
  drawFormalAudit,
  fetchAuditStatus,
  redrawVoidedAudit,
} from "@/shared/infra/verification/verification.functions";
import type { AuditAnswer, AuditStatus } from "@/shared/contracts/verification";
import { Btn, CardGrid, EmptyNote, PageTitle, Panel, Tag } from "@/shared/ui/primitives";
import { pctPrecise } from "@/shared/ui/format";
import { Stat } from "./stat";
import { DECISION } from "./audit-decision";
import { AuditDisagreements } from "./audit-disagreements";
import { FailedControls } from "./audit-failed-controls";
import { Question } from "./audit-question";
import { FormalEvaluation } from "./audit-formal";
import { Tally } from "./audit-tally";

/**
 * The audit of `verified` claims (plan §9, Phase 2): the one measurement of how often "verified"
 * is right. The system draws; the person answers one question per claim. An answer measures the
 * verifier and never changes the claim, so nothing here is an approval.
 */

export function AuditPage() {
  const svc = useServices();
  const [status, setStatus] = useState<AuditStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The count of claims never drawn scans the catalogue, so it is asked for on opening and after
  // a draw, and carried over between answers.
  const load = useCallback(async (countUndrawn = false) => {
    try {
      const next = await fetchAuditStatus({ data: { countUndrawn } });
      setStatus((prev) => {
        const undrawn = next.undrawn ?? prev?.undrawn;
        return undrawn === undefined ? next : { ...next, undrawn };
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load(true);
  }, [load]);

  const act = async (what: () => Promise<unknown>, done?: string, countUndrawn = false) => {
    setBusy(true);
    try {
      await what();
      if (done) toast.success(done);
      await load(countUndrawn);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const current = status?.next;
  const answer = useCallback(
    (a: AuditAnswer, obviouslyWrong: boolean, readVia: "original" | "translation") => {
      if (!current) return;
      void act(() =>
        answerAuditItem({ data: { id: current.id, answer: a, obviouslyWrong, readVia } }),
      );
    },
    // act and load are stable for the page's life; the answer belongs to the claim on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current?.id],
  );

  if (error)
    return (
      <div className="space-y-6">
        <PageTitle>Audit</PageTitle>
        <EmptyNote>The audit could not be loaded ({error}).</EmptyNote>
      </div>
    );
  if (!status) return <PageTitle>Audit</PageTitle>;

  const d = DECISION[status.decision];
  return (
    <div className="space-y-6">
      <PageTitle subtitle="How often a verified claim is right, measured by a person reading a random sample. An answer measures the verifier; it never changes a claim.">
        Audit
      </PageTitle>

      {!status.available ? (
        <EmptyNote>The audit needs the server database (DATABASE_URL).</EmptyNote>
      ) : (
        <>
          <Panel
            title="Result"
            right={
              <Tag tone={d.tone} mono>
                {d.label}
              </Tag>
            }
          >
            <p className="mb-3 text-sm">
              {d.says} Budget: at most {pctPrecise(status.budget)} of verified claims misread, at
              95% confidence.{" "}
              <Link to="/autonomy" className="underline">
                Back to Autonomy
              </Link>
            </p>
            <CardGrid>
              <Tally label="Verified claims audited" t={status.overall} />
              <Stat
                label="Seed set"
                value={`${status.seed.answered} / ${status.seed.size}`}
                hint={status.seed.frozen ? "frozen; no learner reads it" : "not drawn yet"}
              />
              <Stat
                label="Reported apart"
                value={`${status.viaTranslation} · ${status.obviouslyWrong}`}
                hint={`read through a translation · stated but plainly wrong · ${status.undrawn ?? "?"} verified claims never drawn`}
              />
            </CardGrid>
            <FailedControls
              controls={status.failedControls}
              voided={status.voidedAnswers}
              busy={busy}
              onDispute={(id, disputed) =>
                void act(
                  () => disputeAuditControl({ data: { id, disputed } }),
                  disputed ? "Control disputed; its answers count again" : "Dispute withdrawn",
                )
              }
            />
            <FormalEvaluation
              status={status}
              busy={busy}
              onDraw={() => act(() => drawFormalAudit(), "Formal evaluation drawn", true)}
              onRedraw={() =>
                act(async () => {
                  const r = await redrawVoidedAudit();
                  if (!r) throw new Error("No claim is waiting to be asked again");
                })
              }
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {!status.seed.frozen ? (
                <Btn
                  disabled={busy}
                  onClick={() => act(() => drawAuditFirstSession(), "First session drawn", true)}
                >
                  Draw the first session (about 150 claims)
                </Btn>
              ) : (
                <Btn
                  variant={status.decision === "continue" ? "primary" : "ghost"}
                  disabled={busy || status.undrawn === 0}
                  onClick={() => act(() => drawAuditBatch(), "50 more drawn", true)}
                >
                  Draw 50 more
                </Btn>
              )}
            </div>
          </Panel>

          <Panel title={current ? `Claim · ${status.openCount} waiting` : "Claims"}>
            {current ? (
              <Question key={current.id} item={current} onAnswer={answer} busy={busy} />
            ) : (
              <EmptyNote>
                {status.seed.frozen
                  ? "Nothing waiting. The formal evaluation above is what proves the budget."
                  : "Draw the first session to begin."}
              </EmptyNote>
            )}
          </Panel>

          {status.reader && (
            <Panel
              title="Second reader against your answers"
              right={
                <Tag tone="muted" mono>
                  {status.reader.measured} measured
                </Tag>
              }
            >
              <p className="mb-3 text-xs text-muted-foreground">
                On the claims you answered that the independent model also read. It changes no claim
                until this shows its &quot;supported&quot; can be trusted.
                {status.reader.independenceUnknown > 0 &&
                  ` ${status.reader.independenceUnknown} of these claims do not record the model that extracted them, so the reader may have been that model.`}
              </p>
              <CardGrid>
                <Stat
                  label="It said supported"
                  value={`${status.reader.agreement.supported.no} / ${
                    status.reader.agreement.supported.yes + status.reader.agreement.supported.no
                  }`}
                  hint={`you said the post does not state it · wrong ≤ ${pctPrecise(status.reader.supportedErrorBound)}`}
                />
                <Stat
                  label="It opposed the claim"
                  value={`${status.reader.agreement.unsupported.yes} / ${
                    status.reader.agreement.unsupported.yes + status.reader.agreement.unsupported.no
                  }`}
                  hint={`you said the post does state it · contradicted ${
                    status.reader.agreement.contradicted.yes +
                    status.reader.agreement.contradicted.no
                  } · not found ${
                    status.reader.agreement.notFound.yes + status.reader.agreement.notFound.no
                  } · legacy ${
                    status.reader.agreement.legacyUnsupported.yes +
                    status.reader.agreement.legacyUnsupported.no
                  }`}
                />
                <Stat label="It could not say" value={`${status.reader.agreement.uncertain}`} />
              </CardGrid>
              {status.reader.afterDraw && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Readings made after the draw, apart from the figures above:{" "}
                  {status.reader.afterDraw.measured} claims, {status.reader.afterDraw.blind} read
                  before you answered it. They are not what the reader said when the claim was
                  drawn.
                </p>
              )}
              {status.reader.legacy && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {status.reader.legacy.measured} older readings are kept as history; they were
                  written before a reading was tied to a claim version and are not counted above.
                </p>
              )}
            </Panel>
          )}

          {status.reader && <AuditDisagreements />}

          {status.byFamily.length > 0 && (
            <Panel title="By language and family">
              <CardGrid>
                {status.byLanguage.map((l) => (
                  <Tally key={l.language} label={`language · ${l.language}`} t={l} />
                ))}
                {status.byFamily.map((f) => (
                  <Tally key={f.family} label={`${f.family}${f.alarm ? " · flagged" : ""}`} t={f} />
                ))}
              </CardGrid>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
