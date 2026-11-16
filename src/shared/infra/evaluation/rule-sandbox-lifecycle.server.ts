import { newShadowMetrics } from "@/shared/infra/evaluation/autonomy";
import {
  bumpRuleVersion,
  recordDecision,
  rulesRepo,
  rulesSqlAvailable,
} from "@/shared/infra/evaluation/rule-sandbox-store.server";
import { replayRule } from "@/shared/infra/evaluation/rule-sandbox-replay.server";

/** Analyst: send a passed rule to shadow so it earns metrics before going live. */
export async function shadowRule(id: string) {
  if (!rulesSqlAvailable()) return { ok: false };
  const moved = await rulesRepo().startShadow(id, newShadowMetrics(new Date().toISOString()));
  if (moved) await recordDecision(id, "shadowed", "analyst");
  return { ok: moved };
}

/** Reject a candidate, or quarantine an active rule (which reloads the snapshot). */
export async function rejectRule(id: string) {
  if (!rulesSqlAvailable()) return { ok: false };
  const status = await rulesRepo().rejectOrQuarantine(id);
  if (status) await recordDecision(id, status, "analyst");
  if (status === "quarantined") {
    await bumpRuleVersion(`quarantine ${id}`);
    // After the bump, so the posts are read again without the rule.
    await replayRule(id);
  }
  return { ok: status !== null };
}

export async function quarantine(ids: string[], note: string) {
  const moved: string[] = [];
  for (const id of ids) {
    if (await rulesRepo().quarantineActive(id)) {
      await recordDecision(id, "quarantined", "circuit_breaker", note);
      moved.push(id);
    }
  }
  if (ids.length) await bumpRuleVersion(`circuit breaker: ${ids.join(", ")}`);
  // Only a rule that was active and is now quarantined; replayRule never throws.
  for (const id of moved) await replayRule(id);
}
