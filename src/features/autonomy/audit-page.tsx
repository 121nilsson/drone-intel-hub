import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useServices } from "@/shared/infra/services";
import {
  answerAuditItem,
  drawAuditBatch,
  drawAuditFirstSession,
  fetchAuditStatus,
} from "@/shared/infra/verification/verification.functions";
import type { AuditAnswer, AuditItem, AuditStatus } from "@/shared/contracts/verification";
import { Btn, CardGrid, EmptyNote, PageTitle, Panel, Tag } from "@/shared/ui/primitives";
import { Stat } from "./stat";
import { SourceRef, SystemChip } from "@/shared/ui/links";
import { TranslateButton } from "@/shared/ui/translate-button";

/**
 * The audit of `verified` claims (plan §9, Phase 2): the one measurement of how often "verified"
 * is right. The system draws; the person answers one question per claim. An answer measures the
 * verifier and never changes the claim, so nothing here is an approval.
 */

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const DECISION: Record<
  AuditStatus["decision"],
  { label: string; tone: "success" | "danger" | "warning" | "muted"; says: string }
> = {
  pass: {
    label: "pass",
    tone: "success",
    says: "Verified precision is proven within the budget.",
  },
  fail: {
    label: "fail",
    tone: "danger",
    says: "Verified claims are proven to be wrong more often than the budget allows.",
  },
  not_proven: {
    label: "not proven",
    tone: "warning",
    says: "The audit reached its maximum without proving precision within the budget.",
  },
  continue: {
    label: "open",
    tone: "muted",
    says: "Not settled yet: the first decision is after 100 answers, then after every 50.",
  },
};

/**
 * The post with the quote marked, matched the way the verifier matched it (entities/drone/
 * verification.ts): NFKC-folded, across whitespace and case. A looser or stricter match would
 * leave some verified claims unmarked, and an unmarked claim would stand out from the rest.
 */
function PostWithQuote({ text: raw, quote }: { text: string; quote?: string | undefined }) {
  const text = useMemo(() => raw.normalize("NFKC"), [raw]);
  const parts = useMemo(() => {
    const q = quote?.normalize("NFKC").trim();
    if (!q) return null;
    const pattern = q
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    const m = new RegExp(pattern, "iu").exec(text);
    return m
      ? { before: text.slice(0, m.index), hit: m[0], after: text.slice(m.index + m[0].length) }
      : null;
  }, [text, quote]);
  return (
    <p className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">
      {parts ? (
        <>
          {parts.before}
          <mark className="bg-primary/25 text-foreground">{parts.hit}</mark>
          {parts.after}
        </>
      ) : (
        text
      )}
    </p>
  );
}

function Question({
  item,
  translateModel,
  onAnswer,
  busy,
}: {
  item: AuditItem;
  translateModel: string;
  onAnswer: (
    answer: AuditAnswer,
    obviouslyWrong: boolean,
    readVia: "original" | "translation",
  ) => void;
  busy: boolean;
}) {
  const [obviouslyWrong, setObviouslyWrong] = useState(false);
  // Defaults to how a post in this language is likely read; the auditor corrects it.
  const [readVia, setReadVia] = useState<"original" | "translation">(
    item.language === "en" ? "original" : "translation",
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy || e.metaKey || e.ctrlKey || e.altKey) return;
      // Only typing suppresses the shortcuts: a ticked checkbox keeps focus, and the auditor's
      // next key is still an answer.
      const t = e.target;
      if (
        (t instanceof HTMLInputElement && t.type !== "checkbox") ||
        t instanceof HTMLTextAreaElement
      )
        return;
      const k = e.key.toLowerCase();
      if (k === "y") onAnswer("yes", obviouslyWrong, readVia);
      else if (k === "n") onAnswer("no", obviouslyWrong, readVia);
      else if (k === "c") onAnswer("cannot_tell", obviouslyWrong, readVia);
      else if (k === "w") setObviouslyWrong((v) => !v);
      else if (k === "t") setReadVia((v) => (v === "original" ? "translation" : "original"));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, obviouslyWrong, readVia, onAnswer]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Does the post state this value for this attribute of this system?
        </p>
        <p className="flex flex-wrap items-center gap-2 text-base">
          <SystemChip id={item.droneId} name={item.droneName} />
          <span className="text-muted-foreground">·</span>
          <span>{item.specLabel}</span>
          <span className="text-muted-foreground">=</span>
          <span className="font-mono font-semibold">{item.value}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          <SourceRef source={item.source} /> · {item.language} · {item.family}
        </p>
      </div>

      {item.postText ? (
        <div className="border border-border p-3">
          <PostWithQuote text={item.postText} quote={item.evidence} />
          {item.language !== "en" && (
            <div className="mt-2">
              <TranslateButton key={item.id} text={item.postText} model={translateModel} />
            </div>
          )}
        </div>
      ) : (
        <EmptyNote>
          The post was not archived. Answer "can't tell" unless the quote alone settles it.
        </EmptyNote>
      )}
      {item.evidence && (
        <p className="text-xs text-muted-foreground">
          Quoted evidence: <span className="italic">“{item.evidence}”</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Btn disabled={busy} onClick={() => onAnswer("yes", obviouslyWrong, readVia)}>
          Yes <kbd className="ml-1 opacity-60">Y</kbd>
        </Btn>
        <Btn
          variant="danger"
          disabled={busy}
          onClick={() => onAnswer("no", obviouslyWrong, readVia)}
        >
          No <kbd className="ml-1 opacity-60">N</kbd>
        </Btn>
        <Btn
          variant="ghost"
          disabled={busy}
          onClick={() => onAnswer("cannot_tell", obviouslyWrong, readVia)}
        >
          Can't tell <kbd className="ml-1 opacity-60">C</kbd>
        </Btn>
        <label className="ml-2 inline-flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={obviouslyWrong}
            onChange={(e) => setObviouslyWrong(e.target.checked)}
          />
          The post says it, but it is plainly wrong <kbd className="opacity-60">W</kbd>
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={readVia === "translation"}
            onChange={(e) => setReadVia(e.target.checked ? "translation" : "original")}
          />
          Read through a translation <kbd className="opacity-60">T</kbd>
        </label>
      </div>
    </div>
  );
}

function Tally({
  label,
  t,
}: {
  label: string;
  t: { answered: number; errors: number; cannotTell: number; upperBound: number };
}) {
  return (
    <Stat
      label={label}
      value={`${t.errors} / ${t.answered}`}
      hint={`errors · error rate ≤ ${t.answered ? pct(t.upperBound) : "—"} · ${t.cannotTell} can't tell`}
    />
  );
}

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
              {d.says} Budget: at most {pct(status.budget)} of verified claims misread, at 95%
              confidence.{" "}
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
            {status.failedControlBatches.length > 0 && (
              <p className="mt-3 text-sm text-destructive">
                {status.failedControlBatches.length} batch(es) not counted: a hidden control — a
                claim already proven misread — was answered "yes".
              </p>
            )}
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
              <Question
                key={current.id}
                item={current}
                translateModel={svc.settings.translateModel}
                onAnswer={answer}
                busy={busy}
              />
            ) : (
              <EmptyNote>
                {status.seed.frozen
                  ? "Nothing waiting. Draw 50 more for a tighter number."
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
                  hint={`you said the post does not state it · wrong ≤ ${pct(status.reader.supportedErrorBound)}`}
                />
                <Stat
                  label="It said unsupported"
                  value={`${status.reader.agreement.unsupported.yes} / ${
                    status.reader.agreement.unsupported.yes + status.reader.agreement.unsupported.no
                  }`}
                  hint="you said the post does state it"
                />
                <Stat label="It could not say" value={`${status.reader.agreement.uncertain}`} />
              </CardGrid>
            </Panel>
          )}

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
