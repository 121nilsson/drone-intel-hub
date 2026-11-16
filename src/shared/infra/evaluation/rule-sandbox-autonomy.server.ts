import { autonomySwitchEnabled } from "@/shared/infra/autonomy/switches.server";
import {
  PROMOTION_POLICY,
  trustScores,
  type RuleDecision,
  type Trust,
} from "@/shared/infra/evaluation/autonomy";
import {
  iso,
  rulesRepo,
  rulesSqlAvailable,
} from "@/shared/infra/evaluation/rule-sandbox-store.server";

export const autopromoteEnabled = () => autonomySwitchEnabled("rules_autopromote");

export async function decisionsAndTrust() {
  const rows = await rulesRepo().decisions();
  const trust = trustScores(rows as unknown as RuleDecision[]);
  return { trust, autoLast24h: await rulesRepo().autoActivatedLast24h() };
}

export interface AutonomyStatus {
  autopromote: boolean;
  policy: typeof PROMOTION_POLICY;
  trust: Record<string, Trust>;
  autoActivatedLast24h: number;
  recent: { ruleId: string; decision: string; actor: string; note: string | null; at: string }[];
}

export async function getAutonomyStatus(): Promise<AutonomyStatus | null> {
  if (!rulesSqlAvailable()) return null;
  const { trust, autoLast24h } = await decisionsAndTrust();
  const rows = await rulesRepo().recentDecisions();
  return {
    autopromote: autopromoteEnabled(),
    policy: PROMOTION_POLICY,
    trust,
    autoActivatedLast24h: autoLast24h,
    recent: rows.map((r) => ({
      ruleId: r.ruleId,
      decision: r.decision,
      actor: r.actor,
      note: r.note,
      at: iso(r.decidedAt)!,
    })),
  };
}
