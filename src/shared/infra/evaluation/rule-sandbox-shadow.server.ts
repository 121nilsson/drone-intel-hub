import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { compileRuleSnapshot, type DynamicRuleRow } from "@/shared/contracts/rules";
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
import { activeRows, json, loadCatalog } from "@/shared/infra/evaluation/rule-sandbox-store.server";
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
  if (!dbConfigured()) return { ran: false, reason: "no database configured", ...none };
  try {
    const rows = await db()`
      select id, kind, language, payload, origin, target_key, shadow_metrics
      from dynamic_rules where status = 'shadow' order by created_at`;
    if (!rows.length) return { ran: true, reason: "no shadow rules", ...none };
    const drones = await loadCatalog();
    const since = rows
      .map(
        (r) => (r["shadow_metrics"] as ShadowMetrics | null)?.watermark ?? new Date().toISOString(),
      )
      .sort()[0]!;
    // shadowStep takes at most 200 per rule; a deeper backlog drains over later runs.
    const candidates = await candidatesSince(since, 1000);
    let { trust, autoLast24h } = await decisionsAndTrust();
    let active = await activeRows();
    const promoted: string[] = [];
    let evaluated = 0;
    for (const r of rows) {
      const rule = r as unknown as DynamicRuleRow;
      const before =
        (r["shadow_metrics"] as ShadowMetrics | null) ?? newShadowMetrics(new Date().toISOString());
      const metrics = await shadowStep(
        before,
        candidates,
        drones,
        new HeuristicExtractor(1, compileRuleSnapshot(active)),
        new HeuristicExtractor(1, compileRuleSnapshot([...active, rule])),
      );
      evaluated += metrics.evaluated - before.evaluated;
      const category = ruleCategory(r["kind"] as string, r["target_key"] as string | null);
      const verdict = promotionVerdict({
        origin: r["origin"] as string,
        metrics,
        trust: trust[category],
        autoActivatedLast24h: autoLast24h,
        now: new Date(),
      });
      const blockers = autopromoteEnabled()
        ? verdict.reasons
        : [...verdict.reasons, "auto-promotion disabled (RULES_AUTOPROMOTE=off)"];
      await db()`update dynamic_rules set shadow_metrics = ${json({ ...metrics, blockers })}
        where id = ${rule.id}`;
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
