import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { autonomySwitchEnabled } from "@/shared/infra/autonomy/switches.server";
import {
  PROMOTION_POLICY,
  trustScores,
  type RuleDecision,
  type Trust,
} from "@/shared/infra/evaluation/autonomy";
import { iso } from "@/shared/infra/evaluation/rule-sandbox-store.server";

export const autopromoteEnabled = () => autonomySwitchEnabled("rules_autopromote");

export async function decisionsAndTrust() {
  const rows = await db()`select category, origin, decision, actor from rule_decisions`;
  const trust = trustScores(rows as unknown as RuleDecision[]);
  const [c] = await db()`
    select count(*)::int as n from rule_decisions
    where decision = 'auto_activated' and decided_at > now() - interval '24 hours'`;
  return { trust, autoLast24h: Number(c?.["n"] ?? 0) };
}

export interface AutonomyStatus {
  autopromote: boolean;
  policy: typeof PROMOTION_POLICY;
  trust: Record<string, Trust>;
  autoActivatedLast24h: number;
  recent: { ruleId: string; decision: string; actor: string; note: string | null; at: string }[];
}

export async function getAutonomyStatus(): Promise<AutonomyStatus | null> {
  if (!dbConfigured()) return null;
  const { trust, autoLast24h } = await decisionsAndTrust();
  const rows = await db()`
    select rule_id, decision, actor, note, decided_at from rule_decisions
    order by decided_at desc limit 20`;
  return {
    autopromote: autopromoteEnabled(),
    policy: PROMOTION_POLICY,
    trust,
    autoActivatedLast24h: autoLast24h,
    recent: rows.map((r) => ({
      ruleId: r["rule_id"] as string,
      decision: r["decision"] as string,
      actor: r["actor"] as string,
      note: (r["note"] as string | null) ?? null,
      at: iso(r["decided_at"])!,
    })),
  };
}
