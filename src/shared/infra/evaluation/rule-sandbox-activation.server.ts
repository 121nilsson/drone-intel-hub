import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { sandboxRule } from "@/shared/infra/evaluation/rule-sandbox-sandbox.server";
import { withActivationLock } from "@/shared/infra/evaluation/rule-sandbox-lock.server";
import {
  bumpRuleVersion,
  recordDecision,
} from "@/shared/infra/evaluation/rule-sandbox-store.server";

/**
 * Activation by an analyst or by auto-promotion: re-sandbox now, activate only on a pass, then
 * hot-reload everywhere. A shadow rule that now breaks a fixture is rejected outright.
 */
export async function activateRule(id: string, actor: "analyst" | "autonomous" = "analyst") {
  if (!dbConfigured()) return { ok: false, reason: "no database configured" };
  return withActivationLock(() => activateLocked(id, actor));
}

export async function activateLocked(id: string, actor: "analyst" | "autonomous") {
  const res = await sandboxRule(id, "fast");
  if (!res.ok || !res.result) return { ok: false, reason: res.reason ?? "sandbox failed" };
  if (!res.result.passed) {
    if (res.result.regressions.length) {
      const [r] = await db()`
        update dynamic_rules set status = 'rejected' where id = ${id} and status = 'shadow'
        returning id`;
      if (r) await recordDecision(id, "rejected", "sandbox", res.result.reasons.join("; "));
    }
    return { ok: false, reason: res.result.reasons.join("; "), result: res.result };
  }
  await db()`
    update dynamic_rules set status = 'active', promoted_at = now(),
      decided_by = ${actor === "analyst" ? "analyst" : "autonomous_sandbox"}, version = version + 1
    where id = ${id}`;
  await recordDecision(id, actor === "analyst" ? "activated" : "auto_activated", actor);
  await bumpRuleVersion(`${actor === "analyst" ? "activate" : "auto-activate"} ${id}`);
  return { ok: true, result: res.result };
}
