import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { compileRuleSnapshot, ruleTerms, type DynamicRuleRow } from "@/shared/contracts/rules";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { breakerTrips } from "@/shared/infra/evaluation/autonomy";
import { memoExtractor, runSandbox } from "@/shared/infra/evaluation/sandbox";
import {
  candidateSample,
  candidatesMentioning,
  CONTROL_POOL,
  mergeById,
} from "@/shared/infra/evaluation/rule-sandbox-candidates.server";
import { loadFixtures } from "@/shared/infra/evaluation/rule-sandbox-fixtures.server";
import {
  json,
  loadCatalog,
  rulesVersion,
} from "@/shared/infra/evaluation/rule-sandbox-store.server";
import { quarantine } from "@/shared/infra/evaluation/rule-sandbox-lifecycle.server";

export interface SuperviseResult {
  ran: boolean;
  reason: string;
  breaker: { checked: number; tripped: boolean; reasons: string[] };
  audited: number;
  quarantined: string[];
}

/** Active rules audited per night by leave-one-out full sandbox (budget). */
export const MAX_AUDIT_PER_RUN = 10;

/**
 * Nightly supervision of live rules. 1) Circuit breaker: the full corpus and a fresh sample with
 * all active rules vs without those activated in the last 24 h - a drop beyond BREAKER_F1_DROP
 * or any broken fixture quarantines all of them. 2) Audit: each older rule is re-checked without
 * it on the fixtures that contain its words plus the control set; one that now breaks a fixture
 * (the corpus grew) is quarantined.
 */
export async function superviseActiveRules(): Promise<SuperviseResult> {
  const empty = {
    breaker: { checked: 0, tripped: false, reasons: [] as string[] },
    audited: 0,
    quarantined: [] as string[],
  };
  if (!dbConfigured()) return { ran: false, reason: "no database configured", ...empty };
  try {
    const rows = await db()`
      select id, kind, language, payload,
        coalesce(promoted_at > now() - interval '24 hours', false) as recent
      from dynamic_rules where status = 'active' order by promoted_at desc nulls last`;
    const all = rows as unknown as (DynamicRuleRow & { recent: boolean })[];
    if (!all.length) return { ran: true, reason: "no active rules", ...empty };
    const drones = await loadCatalog();
    const fixtures = await loadFixtures(drones);
    const control = await candidateSample(CONTROL_POOL);
    const version = await rulesVersion();
    // "proposed" = everything live now, the same for every run below, so each text is read
    // with it once per supervision instead of once per audited rule.
    const proposed = memoExtractor(new HeuristicExtractor(1, compileRuleSnapshot(all)));
    // "baseline" = live minus the rules under suspicion.
    const run = async (suspects: DynamicRuleRow[], mode: "breaker" | "audit") => {
      const terms = [...new Set(suspects.flatMap(ruleTerms))];
      const result = await runSandbox({
        fixtures,
        candidates: mergeById(await candidatesMentioning(terms), control),
        catalog: drones,
        baseline: new HeuristicExtractor(
          1,
          compileRuleSnapshot(all.filter((r) => !suspects.includes(r))),
        ),
        proposed,
        terms,
        // The breaker reads the whole corpus: it guards against rules that only break in
        // combination, which their own words cannot point to. An audit asks whether one rule
        // now breaks a fixture, and a rule of literal words can only change a text containing
        // one of them, so it reads those fixtures plus the fixed control set, as activation does.
        mode: mode === "breaker" ? "full" : "fast",
      });
      for (const r of suspects)
        await db()`
          insert into rule_evaluations (rule_id, passed, corpus_size, regressions, broken_fixtures, f1_delta, mode, rules_version, report)
          values (${r.id}, ${result.regressions.length === 0}, ${result.corpusSize}, ${result.regressions.length},
            ${json(result.regressions.map((x) => x.id))}, ${result.f1Delta}, ${mode}, ${version}, ${json(result)})`;
      return result;
    };

    const quarantined: string[] = [];
    const recent = all.filter((r) => r.recent);
    const breaker = { checked: recent.length, tripped: false, reasons: [] as string[] };
    if (recent.length) {
      const verdict = breakerTrips(await run(recent, "breaker"));
      breaker.tripped = verdict.trips;
      breaker.reasons = verdict.reasons;
      if (verdict.trips) {
        await quarantine(
          recent.map((r) => r.id),
          verdict.reasons.join("; "),
        );
        quarantined.push(...recent.map((r) => r.id));
        console.warn("[evaluation:rules] circuit breaker tripped:", verdict.reasons.join("; "));
      }
    }
    let audited = 0;
    for (const r of all) {
      if (r.recent || quarantined.includes(r.id) || audited >= MAX_AUDIT_PER_RUN) continue;
      audited++;
      const result = await run([r], "audit");
      if (result.regressions.length) {
        await quarantine([r.id], `audit: ${result.regressions.length} fixture(s) regress`);
        quarantined.push(r.id);
      }
    }
    return { ran: true, reason: "ok", breaker, audited, quarantined };
  } catch (e) {
    return { ran: false, reason: e instanceof Error ? e.message : String(e), ...empty };
  }
}
