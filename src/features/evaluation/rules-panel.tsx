import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Btn, Card, Panel, Tag } from "@/shared/ui/primitives";
import {
  fetchRules,
  triggerActivateRule,
  triggerMineRules,
  triggerProposeRule,
  triggerRejectRule,
  triggerSandboxRule,
} from "@/shared/infra/evaluation.functions";
import type { RuleView } from "@/shared/infra/rule-sandbox.server";
import type { RuleKind, RuleLanguage } from "@/shared/contracts/rules";
import type { SandboxResult } from "./sandbox";

const TONE: Record<string, "success" | "warning" | "danger" | "info" | "muted" | "primary"> = {
  active: "success",
  candidate_passed: "primary",
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
  add_unit_scale: `{ "unit": "млрд", "multiplier": 1000000000, "dimension": "currency" }`,
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

/**
 * Dynamic-rule lifecycle on /evaluation: mine → sandbox → activate. Activation re-runs the
 * sandbox server-side, so the button can never push a rule the corpus has not just accepted.
 */
export function RulesPanel() {
  const [rules, setRules] = useState<RuleView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [kind, setKind] = useState<RuleKind>("add_stopword");
  const [language, setLanguage] = useState<RuleLanguage>("all");
  const [payload, setPayload] = useState(EXAMPLES.add_stopword);

  const reload = useCallback(() => {
    fetchRules()
      .then(setRules)
      .catch(() => {});
  }, []);
  useEffect(reload, [reload]);

  const act = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    try {
      toast.success(await fn());
    } catch (e) {
      toast.error(`${label}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      reload();
    }
  };

  const propose = () =>
    act("Föreslå", async () => {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const p = await triggerProposeRule({ data: { kind, language, payload: parsed } });
      if (!p.ok || !p.id) throw new Error(p.reason ?? "kunde inte spara");
      const s = await triggerSandboxRule({ data: { id: p.id } });
      return s.result?.passed
        ? "Regeln klarade sandlådan — kan aktiveras"
        : `Sandlåda: ${s.result?.reasons.join("; ") ?? s.reason}`;
    });

  return (
    <Panel title="Dynamiska regler (sandlåda)">
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
          {busy === "Hypoteser" ? "Gräver…" : "Generera regelhypoteser"}
        </Btn>
        <Btn variant="ghost" disabled={!!busy} onClick={reload}>
          Uppdatera
        </Btn>
      </div>

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
                {r.status !== "active" && (
                  <Btn
                    disabled={!!busy || r.status !== "candidate_passed"}
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
            {r.lastEvaluation && <Verdict r={r.lastEvaluation} />}
          </Card>
        ))}
      </ul>
    </Panel>
  );
}
