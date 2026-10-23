import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Btn, Card, Panel, Tag } from "@/shared/ui/primitives";
import {
  fetchAutonomy,
  fetchRules,
  triggerActivateRule,
  triggerMineRules,
  triggerProposeRule,
  triggerRejectRule,
  triggerRunShadow,
  triggerSandboxRule,
  triggerShadowRule,
  triggerSupervise,
} from "@/shared/infra/evaluation/evaluation.functions";
import type { AutonomyStatus, RuleView } from "@/shared/infra/evaluation/rule-sandbox.server";
import type { RuleKind, RuleLanguage } from "@/shared/contracts/rules";
import type { SandboxResult } from "@/shared/infra/evaluation/sandbox";
import { ActionList } from "./action-list";

const TONE: Record<string, "success" | "warning" | "danger" | "info" | "muted" | "primary"> = {
  active: "success",
  candidate_passed: "primary",
  shadow: "warning",
  candidate: "info",
  evaluating: "info",
  rejected: "muted",
  quarantined: "danger",
  superseded: "muted",
};

/** What a rule in each status is waiting for, in the words of the button that moves it on. */
const NEXT: Record<string, string> = {
  candidate: "run Full sandbox to test it against the corpus.",
  evaluating: "the sandbox is running.",
  candidate_passed:
    "passed the sandbox. Shadow it to measure it on new reports first, or Activate it now.",
  shadow: "being measured on new reports. Activate when the numbers convince you, or Reject it.",
  active: "live in every pipeline. Quarantine it if it misreads.",
};

const EXAMPLES: Record<RuleKind, string> = {
  add_stopword: `{ "word": "sparta" }`,
  add_alias: `{ "droneId": "lancet-3", "alias": "Izdeliye 52" }`,
  add_cue: `{ "target": "range", "terms": ["дальність польоту"] }`,
  context_filter: `{ "key": "altitude", "triggerWords": ["interception"], "action": "reroute", "targetKey": "target_altitude_max", "maxTokenDistance": 4 }`,
  add_unit_scale: `{ "unit": "лям", "multiplier": 1000000, "dimension": "currency" }`,
};

const f1 = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(3);

function Verdict({ r }: { r: SandboxResult & { evaluatedAt: string } }) {
  return (
    <div className="mt-2 space-y-1 font-mono text-[11px]">
      <div className="flex flex-wrap gap-2">
        <Tag tone={r.passed ? "success" : "danger"}>{r.passed ? "sandbox ok" : "failed"}</Tag>
        <span className="text-muted-foreground">
          {r.mode} · {r.corpusSize} fixtures · {r.regressions.length} regressions · {r.fixed.length}{" "}
          fixed · {r.changedCandidates}/{r.affectedCandidates} reports changed · ΔF1 {f1(r.f1Delta)}
        </span>
      </div>
      <div className="text-muted-foreground">
        F1 spec {r.before.spec.f1.toFixed(3)} → {r.after.spec.f1.toFixed(3)} · name{" "}
        {r.before.name.f1.toFixed(3)} → {r.after.name.f1.toFixed(3)} · matchId{" "}
        {r.before.matchId.f1.toFixed(3)} → {r.after.matchId.f1.toFixed(3)}
      </div>
      {r.reasons.length > 0 && <div className="text-destructive">{r.reasons.join("; ")}</div>}
      {r.regressions.slice(0, 3).map((b) => (
        <div key={b.id} className="break-words text-destructive">
          {b.source}: {b.failures.join(", ")}
        </div>
      ))}
      {r.preview.length > 0 && (
        <ul className="space-y-1">
          {r.preview.slice(0, 5).map((p) => (
            <li key={p.candidateId} className="break-words">
              <span className="text-muted-foreground">{p.source}: </span>
              {p.before.length > 0 && <span className="line-through">{p.before.join(", ")}</span>}
              {p.before.length > 0 && p.after.length > 0 && " → "}
              {p.after.length > 0 && <span className="text-success">{p.after.join(", ")}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Shadow({ m }: { m: NonNullable<RuleView["shadow"]> }) {
  const decided = m.concordant + m.conflicts;
  return (
    <div className="mt-2 space-y-1 font-mono text-[11px]">
      <div className="text-muted-foreground">
        shadow since {m.startedAt.slice(0, 16).replace("T", " ")} · {m.evaluated} new reports ·{" "}
        {m.hits} hits · {m.concordant} better · {m.conflicts} worse
        {decided > 0 && ` · precision ${Math.round((m.concordant / decided) * 100)}%`}
      </div>
      {m.blockers && m.blockers.length > 0 && (
        <div className="text-muted-foreground">Waiting on: {m.blockers.join(" · ")}</div>
      )}
    </div>
  );
}

function Autonomy({ a }: { a: AutonomyStatus }) {
  const trust = Object.entries(a.trust).sort(([, x], [, y]) => y.decisions - x.decisions);
  return (
    <div className="mb-3 space-y-1 border border-border p-3 font-mono text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={a.autopromote ? "success" : "muted"}>
          {a.autopromote ? "auto-activation on" : "auto-activation off"}
        </Tag>
        <span className="text-muted-foreground">
          requires ≥{a.policy.minShadowHours} h shadow, ≥{a.policy.minHits} hits, 0 conflicts,
          precision ≥{a.policy.minPrecision * 100}%, trust ≥{a.policy.minTrust * 100}% over ≥
          {a.policy.minDecisions} analyst decisions · {a.autoActivatedLast24h}/
          {a.policy.maxAutoPerDay} auto in the last 24 h
        </span>
      </div>
      {trust.length > 0 && (
        <div className="break-words text-muted-foreground">
          Trust:{" "}
          {trust.map(([k, t]) => `${k} ${Math.round(t.score * 100)}% (${t.decisions})`).join(" · ")}
        </div>
      )}
      {a.recent.slice(0, 5).map((d) => (
        <div key={d.ruleId + d.at} className="break-words text-muted-foreground">
          {d.at.slice(0, 16).replace("T", " ")} {d.actor} {d.decision} {d.ruleId}
          {d.note ? ` — ${d.note}` : ""}
        </div>
      ))}
    </div>
  );
}

/**
 * Dynamic-rule lifecycle on /evaluation: mine → sandbox → activate. Activation re-runs the
 * sandbox server-side, so the button can never push a rule the corpus has not just accepted.
 */
export function RulesPanel() {
  const [rules, setRules] = useState<RuleView[]>([]);
  const [autonomy, setAutonomy] = useState<AutonomyStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [busyStartedAt, setBusyStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [kind, setKind] = useState<RuleKind>("add_stopword");

  useEffect(() => {
    if (!busy || !busyStartedAt) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [busy, busyStartedAt]);
  const [language, setLanguage] = useState<RuleLanguage>("all");
  const [payload, setPayload] = useState(EXAMPLES.add_stopword);
  const [lastVerdict, setLastVerdict] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetchRules()
      .then(setRules)
      .catch(() => {});
    fetchAutonomy()
      .then(setAutonomy)
      .catch(() => {});
  }, []);
  useEffect(reload, [reload]);

  const act = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setBusyStartedAt(Date.now());
    try {
      toast.success(await fn());
    } catch (e) {
      toast.error(`${label}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      setBusyStartedAt(null);
      reload();
    }
  };

  const propose = () =>
    act("Propose", async () => {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const p = await triggerProposeRule({ data: { kind, language, payload: parsed } });
      if (!p.ok || !p.id) throw new Error(p.reason ?? "could not save");
      const s = await triggerSandboxRule({ data: { id: p.id, mode: "fast" } });
      const verdict = s.result?.passed
        ? "Sandbox passed - rule can be activated or shadowed"
        : `Sandbox failed: ${s.result?.reasons.join("; ") ?? s.reason}`;
      setLastVerdict(verdict);
      return verdict;
    });

  return (
    <Panel title="Rules">
      <div className="mb-3 space-y-2 text-xs text-muted-foreground">
        <p>
          A rule is a small change to what the heuristic reads: a word that is never a system name
          (stopword), another name for a known system (alias), a cue word for an attribute, a
          context that moves a figure to another attribute, or a money magnitude word.
        </p>
        <p>
          Every rule goes <strong>sandbox → shadow → active</strong>. The sandbox replays the test
          corpus and passes a rule only with zero regressions and an F1 gain. Shadow then measures
          it on new reports without affecting them.{" "}
          {autonomy?.autopromote
            ? "Auto-activation is on: a shadow rule activates itself once it meets the bar shown below. You can still activate or reject any rule yourself."
            : "Auto-activation is off: only an analyst can activate a rule."}
        </p>
      </div>
      {lastVerdict && (
        <div className="mb-3 border border-border bg-secondary/40 px-3 py-2 font-mono text-xs">
          Last sandbox: {lastVerdict}
        </div>
      )}
      <div className="mb-3">
        <ActionList
          items={[
            {
              button: (
                <Btn
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() =>
                    act("Hypotheses", async () => {
                      const r = await triggerMineRules();
                      if (!r.ran) throw new Error(r.reason);
                      return `${r.mined} hypotheses, ${r.proposed} new, ${r.passed}/${r.sandboxed} passed the sandbox · ${r.parserDefects} parser defects`;
                    })
                  }
                >
                  {busy === "Hypotheses" && busyStartedAt
                    ? `Mining… ${Math.max(1, Math.round((now - busyStartedAt) / 1000))}s`
                    : busy === "Hypotheses"
                      ? "Mining…"
                      : "Generate rule hypotheses"}
                </Btn>
              ),
              does: "Looks for misreadings that recur across the corpus and proposes a rule for each, already sandboxed. Takes 30-60 s.",
            },
            {
              button: (
                <Btn
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() =>
                    act("Shadow", async () => {
                      const r = await triggerRunShadow();
                      if (!r.ran) throw new Error(r.reason);
                      return `${r.rules} shadow rules, ${r.evaluated} new reports, promoted: ${r.promoted.length}`;
                    })
                  }
                >
                  Run shadow now
                </Btn>
              ),
              does: autonomy?.autopromote
                ? "Measures every shadow rule on the reports that arrived since the last run, then activates the ones that meet the bar."
                : "Measures every shadow rule on the reports that arrived since the last run.",
            },
            {
              button: (
                <Btn
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() =>
                    act("Supervise", async () => {
                      const r = await triggerSupervise();
                      if (!r.ran) throw new Error(r.reason);
                      return r.breaker.tripped
                        ? `Circuit breaker tripped: ${r.breaker.reasons.join("; ")}`
                        : `OK · ${r.audited} audited · ${r.quarantined.length} quarantined`;
                    })
                  }
                >
                  Supervise active rules
                </Btn>
              ),
              does: "Safety check: compares all active rules with the same set minus those activated in the last 24 h, and quarantines the recent ones if they made results worse.",
            },
          ]}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          None of these run on a schedule yet: shadow results only grow when someone presses{" "}
          <strong>Run shadow now</strong>.{" "}
          <button type="button" className="underline" disabled={!!busy} onClick={reload}>
            Refresh the list
          </button>
        </p>
      </div>
      {autonomy && <Autonomy a={autonomy} />}

      <details className="mb-3 border border-border p-3">
        <summary className="cursor-pointer text-sm">New rule (analyst)</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <select
            className="border border-border bg-background px-2 py-1 text-sm"
            value={kind}
            onChange={(e) => {
              const k = e.target.value as RuleKind;
              setKind(k);
              setPayload(EXAMPLES[k]);
            }}
          >
            {(Object.keys(EXAMPLES) as RuleKind[]).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <select
            className="border border-border bg-background px-2 py-1 text-sm"
            value={language}
            onChange={(e) => setLanguage(e.target.value as RuleLanguage)}
          >
            {["all", "en", "uk", "ru", "sv"].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </div>
        <textarea
          className="mt-2 w-full border border-border bg-background p-2 font-mono text-xs"
          rows={3}
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
        />
        <Btn disabled={!!busy} onClick={propose}>
          Propose and test in the sandbox
        </Btn>
      </details>

      {rules.length === 0 && <p className="text-sm text-muted-foreground">No rules yet.</p>}
      <ul className="space-y-2">
        {rules.map((r) => (
          <Card as="li" key={r.id} className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Tag tone={TONE[r.status] ?? "default"}>{r.status}</Tag>
                <Tag tone="muted">{r.kind}</Tag>
                {r.language !== "all" && <Tag tone="muted">{r.language}</Tag>}
                <span className="break-all font-mono text-xs">{JSON.stringify(r.payload)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Btn
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() =>
                    act("Sandbox", async () => {
                      const s = await triggerSandboxRule({ data: { id: r.id, mode: "full" } });
                      if (!s.ok) throw new Error(s.reason);
                      return s.result?.passed ? "Passed the full sandbox" : "Failed the sandbox";
                    })
                  }
                >
                  Full sandbox
                </Btn>
                {r.status === "candidate_passed" && (
                  <Btn
                    variant="ghost"
                    disabled={!!busy}
                    title="Runs hidden against new reports without affecting production"
                    onClick={() =>
                      act("Shadow", async () => {
                        const s = await triggerShadowRule({ data: { id: r.id } });
                        if (!s.ok) throw new Error("could not be moved to shadow");
                        return "In shadow — measured on new reports each time shadow runs";
                      })
                    }
                  >
                    Shadow
                  </Btn>
                )}
                {r.status !== "active" && (
                  <Btn
                    disabled={!!busy || (r.status !== "candidate_passed" && r.status !== "shadow")}
                    title="Runs the sandbox again against active rules and activates only if approved"
                    onClick={() =>
                      act("Activate", async () => {
                        const a = await triggerActivateRule({ data: { id: r.id } });
                        if (!a.ok) throw new Error(a.reason);
                        return "Active — takes effect in every pipeline within 30 s";
                      })
                    }
                  >
                    Activate
                  </Btn>
                )}
                {r.status !== "rejected" && r.status !== "quarantined" && (
                  <Btn
                    variant="danger"
                    disabled={!!busy}
                    onClick={() =>
                      act("Reject", async () => {
                        await triggerRejectRule({ data: { id: r.id } });
                        return r.status === "active" ? "Moved to quarantine" : "Rejected";
                      })
                    }
                  >
                    {r.status === "active" ? "Quarantine" : "Reject"}
                  </Btn>
                )}
              </div>
            </div>
            {r.rationale && <p className="mt-1 text-xs text-muted-foreground">{r.rationale}</p>}
            {NEXT[r.status] && <p className="mt-1 text-xs text-primary">Next: {NEXT[r.status]}</p>}
            {r.status === "shadow" && r.shadow && <Shadow m={r.shadow} />}
            {r.lastEvaluation && <Verdict r={r.lastEvaluation} />}
          </Card>
        ))}
      </ul>
    </Panel>
  );
}
