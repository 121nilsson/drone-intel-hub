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
} from "@/shared/infra/evaluation.functions";
import type { AutonomyStatus, RuleView } from "@/shared/infra/rule-sandbox.server";
import type { RuleKind, RuleLanguage } from "@/shared/contracts/rules";
import type { SandboxResult } from "./sandbox";

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
        <Tag tone={r.passed ? "success" : "danger"}>{r.passed ? "sandlåda ok" : "underkänd"}</Tag>
        <span className="text-muted-foreground">
          {r.mode} · {r.corpusSize} fixtures · {r.regressions.length} regressioner ·{" "}
          {r.fixed.length} rättade · {r.changedCandidates}/{r.affectedCandidates} rapporter ändras ·
          ΔF1 {f1(r.f1Delta)}
        </span>
      </div>
      <div className="text-muted-foreground">
        F1 spec {r.before.spec.f1.toFixed(3)} → {r.after.spec.f1.toFixed(3)} · namn{" "}
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
        skugga sedan {m.startedAt.slice(0, 16).replace("T", " ")} · {m.evaluated} nya rapporter ·{" "}
        {m.hits} träffar · {m.concordant} bättre · {m.conflicts} sämre
        {decided > 0 && ` · precision ${Math.round((m.concordant / decided) * 100)}%`}
      </div>
      {m.blockers && m.blockers.length > 0 && (
        <div className="text-muted-foreground">Väntar på: {m.blockers.join(" · ")}</div>
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
          {a.autopromote ? "auto-aktivering på" : "auto-aktivering av"}
        </Tag>
        <span className="text-muted-foreground">
          kräver ≥{a.policy.minShadowHours} h skugga, ≥{a.policy.minHits} träffar, 0 konflikter,
          precision ≥{a.policy.minPrecision * 100}%, trust ≥{a.policy.minTrust * 100}% över ≥
          {a.policy.minDecisions} analytikerbeslut · {a.autoActivatedLast24h}/
          {a.policy.maxAutoPerDay} auto senaste dygnet
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
    act("Föreslå", async () => {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const p = await triggerProposeRule({ data: { kind, language, payload: parsed } });
      if (!p.ok || !p.id) throw new Error(p.reason ?? "kunde inte spara");
      const s = await triggerSandboxRule({ data: { id: p.id, mode: "fast" } });
      const verdict = s.result?.passed
        ? "Sandbox passed - rule can be activated or shadowed"
        : `Sandbox failed: ${s.result?.reasons.join("; ") ?? s.reason}`;
      setLastVerdict(verdict);
      return verdict;
    });

  return (
    <Panel title="Dynamiska regler (sandlåda)">
      <p className="mb-3 text-xs text-muted-foreground">
        Propose a rule as JSON, then sandbox it against the corpus. A rule only becomes activatable
        when the sandbox reports zero regressions and a measurable F1 gain. Rules are never applied
        automatically - an analyst must activate them.
      </p>
      {lastVerdict && (
        <div className="mb-3 border border-border bg-secondary/40 px-3 py-2 font-mono text-xs">
          Last sandbox: {lastVerdict}
        </div>
      )}
      <p className="mb-2 text-xs text-muted-foreground">
        Mining hypotheses can take 30–60 s on a large corpus. The button shows elapsed time while
        running.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Btn
          variant="ghost"
          disabled={!!busy}
          onClick={() =>
            act("Hypoteser", async () => {
              const r = await triggerMineRules();
              if (!r.ran) throw new Error(r.reason);
              return `${r.mined} hypoteser, ${r.proposed} nya, ${r.passed}/${r.sandboxed} klarade sandlådan · ${r.parserDefects} parserdefekter`;
            })
          }
        >
          {busy === "Hypoteser" && busyStartedAt
            ? `Mining… ${Math.max(1, Math.round((now - busyStartedAt) / 1000))}s`
            : busy === "Hypoteser"
              ? "Mining…"
              : "Generate rule hypotheses"}
        </Btn>
        <Btn
          variant="ghost"
          disabled={!!busy}
          onClick={() =>
            act("Skuggläge", async () => {
              const r = await triggerRunShadow();
              if (!r.ran) throw new Error(r.reason);
              return `${r.rules} skuggregler, ${r.evaluated} nya rapporter, aktiverade: ${r.promoted.length}`;
            })
          }
        >
          Kör skuggläge nu
        </Btn>
        <Btn
          variant="ghost"
          disabled={!!busy}
          onClick={() =>
            act("Övervakning", async () => {
              const r = await triggerSupervise();
              if (!r.ran) throw new Error(r.reason);
              return r.breaker.tripped
                ? `Kretsbrytaren löste ut: ${r.breaker.reasons.join("; ")}`
                : `OK · ${r.audited} granskade · ${r.quarantined.length} i karantän`;
            })
          }
        >
          Övervaka aktiva regler
        </Btn>
        <Btn variant="ghost" disabled={!!busy} onClick={reload}>
          Uppdatera
        </Btn>
      </div>
      {autonomy && <Autonomy a={autonomy} />}

      <details className="mb-3 border border-border p-3">
        <summary className="cursor-pointer text-sm">Ny regel (analytiker)</summary>
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
          Föreslå och testa i sandlåda
        </Btn>
      </details>

      {rules.length === 0 && <p className="text-sm text-muted-foreground">Inga regler ännu.</p>}
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
                    act("Sandlåda", async () => {
                      const s = await triggerSandboxRule({ data: { id: r.id, mode: "full" } });
                      if (!s.ok) throw new Error(s.reason);
                      return s.result?.passed ? "Klarade full sandlåda" : "Underkänd i sandlådan";
                    })
                  }
                >
                  Full sandlåda
                </Btn>
                {r.status === "candidate_passed" && (
                  <Btn
                    variant="ghost"
                    disabled={!!busy}
                    title="Kör dolt mot nya rapporter utan att påverka produktionen"
                    onClick={() =>
                      act("Skugga", async () => {
                        const s = await triggerShadowRule({ data: { id: r.id } });
                        if (!s.ok) throw new Error("kunde inte flyttas till skuggläge");
                        return "I skuggläge — mäts mot nya rapporter varje timme";
                      })
                    }
                  >
                    Skuggläge
                  </Btn>
                )}
                {r.status !== "active" && (
                  <Btn
                    disabled={!!busy || (r.status !== "candidate_passed" && r.status !== "shadow")}
                    title="Kör sandlådan igen mot aktiva regler och aktiverar bara vid godkänt"
                    onClick={() =>
                      act("Aktivera", async () => {
                        const a = await triggerActivateRule({ data: { id: r.id } });
                        if (!a.ok) throw new Error(a.reason);
                        return "Aktiv — slår igenom i alla processer inom 30 s";
                      })
                    }
                  >
                    Aktivera
                  </Btn>
                )}
                {r.status !== "rejected" && r.status !== "quarantined" && (
                  <Btn
                    variant="danger"
                    disabled={!!busy}
                    onClick={() =>
                      act("Avvisa", async () => {
                        await triggerRejectRule({ data: { id: r.id } });
                        return r.status === "active" ? "Satt i karantän" : "Avvisad";
                      })
                    }
                  >
                    {r.status === "active" ? "Karantän" : "Avvisa"}
                  </Btn>
                )}
              </div>
            </div>
            {r.rationale && <p className="mt-1 text-xs text-muted-foreground">{r.rationale}</p>}
            {r.status === "shadow" && r.shadow && <Shadow m={r.shadow} />}
            {r.lastEvaluation && <Verdict r={r.lastEvaluation} />}
          </Card>
        ))}
      </ul>
    </Panel>
  );
}
