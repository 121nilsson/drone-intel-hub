import { compileRuleSnapshot } from "@/shared/contracts/rules";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import {
  newShadowMetrics,
  promotionVerdict,
  ruleCategory,
  shadowStep,
  type ShadowMetrics,
} from "@/shared/infra/evaluation/autonomy";
import { activateRule } from "@/shared/infra/evaluation/rule-sandbox-activation.server";
import { candidatesSince } from "@/shared/infra/evaluation/rule-sandbox-candidates.server";
import {
  activeRows,
  loadCatalog,
  rulesRepo,
  rulesSqlAvailable,
} from "@/shared/infra/evaluation/rule-sandbox-store.server";
import {
  autopromoteEnabled,
  decisionsAndTrust,
} from "@/shared/infra/evaluation/rule-sandbox-autonomy.server";

export interface ShadowRunResult {
  ran: boolean;
  reason: string;
  rules: number;
  evaluated: number;
  promoted: string[];
}

/**
 * Score every shadow rule on reports that arrived since it entered shadow, then auto-promote
 * the ones that meet PROMOTION_POLICY. Runs hourly; ingestion itself never waits for shadows.
 */
export async function runShadow(): Promise<ShadowRunResult> {
  const none = { rules: 0, evaluated: 0, promoted: [] as string[] };
  if (!rulesSqlAvailable()) return { ran: false, reason: "no database configured", ...none };
  try {
    const rows = await rulesRepo().shadowRules();
    if (!rows.length) return { ran: true, reason: "no shadow rules", ...none };
    const drones = await loadCatalog();
    const since = rows
      .map((r) => (r.shadowMetrics as ShadowMetrics | null)?.watermark ?? new Date().toISOString())
      .sort()[0]!;
    // shadowStep takes at most 200 per rule; a deeper backlog drains over later runs.
    const candidates = await candidatesSince(since, 1000);
    let { trust, autoLast24h } = await decisionsAndTrust();
    let active = await activeRows();
    const promoted: string[] = [];
    let evaluated = 0;
    for (const rule of rows) {
      const before =
        (rule.shadowMetrics as ShadowMetrics | null) ?? newShadowMetrics(new Date().toISOString());
      const metrics = await shadowStep(
        before,
        candidates,
        drones,
        new HeuristicExtractor(1, compileRuleSnapshot(active)),
        new HeuristicExtractor(1, compileRuleSnapshot([...active, rule])),
      );
      evaluated += metrics.evaluated - before.evaluated;
      const category = ruleCategory(rule.kind, rule.targetKey);
      const verdict = promotionVerdict({
        origin: rule.origin,
        metrics,
        trust: trust[category],
        autoActivatedLast24h: autoLast24h,
        now: new Date(),
      });
      const blockers = autopromoteEnabled()
        ? verdict.reasons
        : [...verdict.reasons, "auto-promotion disabled (RULES_AUTOPROMOTE=off)"];
      await rulesRepo().saveShadowMetrics(rule.id, { ...metrics, blockers });
      if (!verdict.promote || !autopromoteEnabled()) continue;
      const res = await activateRule(rule.id, "autonomous");
      if (!res.ok) continue;
      promoted.push(rule.id);
      // Later shadows compare against the rule set that is now live, and count the cap anew.
      active = await activeRows();
      ({ trust, autoLast24h } = await decisionsAndTrust());
    }
    return { ran: true, reason: "ok", rules: rows.length, evaluated, promoted };
  } catch (e) {
    return { ran: false, reason: e instanceof Error ? e.message : String(e), ...none };
  }
}
