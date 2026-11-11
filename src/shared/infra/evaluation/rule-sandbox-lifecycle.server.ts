import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { newShadowMetrics } from "@/shared/infra/evaluation/autonomy";
import {
  bumpRuleVersion,
  json,
  recordDecision,
} from "@/shared/infra/evaluation/rule-sandbox-store.server";
import { replayRule } from "@/shared/infra/evaluation/rule-sandbox-replay.server";

/** Analyst: send a passed rule to shadow so it earns metrics before going live. */
export async function shadowRule(id: string) {
  if (!dbConfigured()) return { ok: false };
  const rows = await db()`
    update dynamic_rules set status = 'shadow',
      shadow_metrics = ${json(newShadowMetrics(new Date().toISOString()))}
    where id = ${id} and status = 'candidate_passed' returning id`;
  if (rows.length) await recordDecision(id, "shadowed", "analyst");
  return { ok: rows.length > 0 };
}

/** Reject a candidate, or quarantine an active rule (which reloads the snapshot). */
export async function rejectRule(id: string) {
  if (!dbConfigured()) return { ok: false };
  const rows = await db()`
    update dynamic_rules
    set status = case when status = 'active' then 'quarantined' else 'rejected' end,
      decided_by = 'analyst'
    where id = ${id} and status not in ('rejected', 'quarantined', 'superseded')
    returning status`;
  const status = rows[0]?.["status"] as "rejected" | "quarantined" | undefined;
  if (status) await recordDecision(id, status, "analyst");
  if (status === "quarantined") {
    await bumpRuleVersion(`quarantine ${id}`);
    // After the bump, so the posts are read again without the rule.
    await replayRule(id);
  }
  return { ok: rows.length > 0 };
}

export async function quarantine(ids: string[], note: string) {
  const moved: string[] = [];
  for (const id of ids) {
    const [r] = await db()`
      update dynamic_rules set status = 'quarantined', decided_by = 'circuit_breaker'
      where id = ${id} and status = 'active' returning id`;
    if (r) {
      await recordDecision(id, "quarantined", "circuit_breaker", note);
      moved.push(id);
    }
  }
  if (ids.length) await bumpRuleVersion(`circuit breaker: ${ids.join(", ")}`);
  // Only a rule that was active and is now quarantined; replayRule never throws.
  for (const id of moved) await replayRule(id);
}
