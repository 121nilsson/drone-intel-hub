import type { DynamicRuleRow } from "@/shared/contracts/rules";
import type { RuleReader, StoredRule } from "@/shared/contracts/rules-repo";
import { db } from "./db.server";

/** Reads of dynamic_rules and the version counter. */
export function createPostgresRuleReader(): RuleReader {
  return {
    async findRule(id) {
      const [r] =
        await db()`select id, kind, language, payload, status, origin from dynamic_rules where id = ${id}`;
      return r ? (r as unknown as StoredRule) : null;
    },

    async activeRules(exceptId) {
      const rows =
        await db()`select id, kind, language, payload from dynamic_rules where status = 'active'`;
      return (rows as unknown as DynamicRuleRow[]).filter((r) => r.id !== exceptId);
    },

    async rulesVersion() {
      const [v] = await db()`select coalesce(max(version), 0)::int as v from dynamic_rules_version`;
      return Number(v?.["v"] ?? 0);
    },

    async ruleIds() {
      return (await db()`select id from dynamic_rules`).map((r) => r["id"] as string);
    },

    async ruleTarget(id) {
      const [row] =
        await db()`select id, kind, payload, target_key from dynamic_rules where id = ${id}`;
      if (!row) return null;
      return {
        id: row["id"] as string,
        kind: row["kind"] as string,
        payload: row["payload"],
        targetKey: (row["target_key"] as string | null) ?? null,
      };
    },

    async shadowRules() {
      const rows = await db()`
      select id, kind, language, payload, origin, target_key, shadow_metrics
      from dynamic_rules where status = 'shadow' order by created_at`;
      return rows.map((r) => ({
        id: r["id"] as string,
        kind: r["kind"] as string,
        language: r["language"] as string,
        payload: r["payload"],
        origin: r["origin"] as string,
        targetKey: (r["target_key"] as string | null) ?? null,
        shadowMetrics: r["shadow_metrics"],
      }));
    },

    async quarantinedGenerated() {
      const rules = await db()`
    select id, kind, target_key, status, origin from dynamic_rules
    where status = 'quarantined' and origin = 'autonomous_sandbox'`;
      return rules.map((r) => ({
        id: r["id"] as string,
        kind: r["kind"] as string,
        targetKey: (r["target_key"] as string | null) ?? null,
        status: r["status"] as string,
        origin: r["origin"] as string,
      }));
    },

    async activeRulesWithRecency() {
      const rows = await db()`
      select id, kind, language, payload,
        coalesce(promoted_at > now() - interval '24 hours', false) as recent
      from dynamic_rules where status = 'active' order by promoted_at desc nulls last`;
      return rows as unknown as (DynamicRuleRow & { recent: boolean })[];
    },

    async ruleListRows(limit) {
      const rows = await db()`
    select r.*, e.report as eval_report, e.evaluated_at as eval_at, e.rules_version as eval_version
    from dynamic_rules r
    left join lateral (
      select report, evaluated_at, rules_version from rule_evaluations
      where rule_id = r.id order by evaluated_at desc limit 1
    ) e on true
    order by case r.status when 'candidate_passed' then 0 when 'shadow' then 1
      when 'active' then 2 when 'candidate' then 3 else 4 end, r.created_at desc
    limit ${limit}`;
      return rows.map((r) => ({
        id: r["id"] as string,
        kind: r["kind"] as string,
        language: r["language"] as string,
        payload: r["payload"],
        status: r["status"] as string,
        origin: r["origin"] as string,
        targetKey: (r["target_key"] as string | null) ?? null,
        rationale: (r["rationale"] as string | null) ?? null,
        evidence: r["evidence"],
        createdAt: r["created_at"],
        promotedAt: r["promoted_at"],
        shadowMetrics: r["shadow_metrics"],
        evalReport: r["eval_report"],
        evalAt: r["eval_at"],
        evalVersion: (r["eval_version"] as number | null) ?? null,
      }));
    },
  };
}
