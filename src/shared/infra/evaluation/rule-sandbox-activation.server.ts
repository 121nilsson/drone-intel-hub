import { sandboxRule } from "@/shared/infra/evaluation/rule-sandbox-sandbox.server";
import { withActivationLock } from "@/shared/infra/evaluation/rule-sandbox-lock.server";
import {
  bumpRuleVersion,
  recordDecision,
  rulesRepo,
  rulesSqlAvailable,
} from "@/shared/infra/evaluation/rule-sandbox-store.server";

/**
 * Activation by an analyst or by auto-promotion: re-sandbox now, activate only on a pass, then
 * hot-reload everywhere. A shadow rule that now breaks a fixture is rejected outright.
 */
export async function activateRule(id: string, actor: "analyst" | "autonomous" = "analyst") {
  if (!rulesSqlAvailable()) return { ok: false, reason: "no database configured" };
  return withActivationLock(() => activateLocked(id, actor));
}

export async function activateLocked(id: string, actor: "analyst" | "autonomous") {
  const res = await sandboxRule(id, "fast");
  if (!res.ok || !res.result) return { ok: false, reason: res.reason ?? "sandbox failed" };
  if (!res.result.passed) {
    if (res.result.regressions.length) {
      if (await rulesRepo().rejectShadow(id))
        await recordDecision(id, "rejected", "sandbox", res.result.reasons.join("; "));
    }
    return { ok: false, reason: res.result.reasons.join("; "), result: res.result };
  }
  await rulesRepo().activate(id, actor === "analyst" ? "analyst" : "autonomous_sandbox");
  await recordDecision(id, actor === "analyst" ? "activated" : "auto_activated", actor);
  await bumpRuleVersion(`${actor === "analyst" ? "activate" : "auto-activate"} ${id}`);
  return { ok: true, result: res.result };
}
