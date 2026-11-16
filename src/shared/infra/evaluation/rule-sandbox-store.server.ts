import { serverServices } from "@/shared/infra/server-services.server";
import { getOrRefreshRuleSnapshot } from "@/shared/infra/heuristics/rule-registry.server";
import { documentsOf } from "@/shared/contracts/store";
import type { DecisionActor, DecisionKind } from "@/shared/contracts/rules-repo";
import type { Drone } from "@/entities/drone/types";

export const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

/** The rule persistence port. Resolved per call: the backend is chosen by the environment. */
export const rulesRepo = () => serverServices().rules;

/** Whether the backend has the SQL database the rule loops need (what dbConfigured() asked). */
export const rulesSqlAvailable = () => serverServices().backend.capabilities.sql;

export async function loadCatalog() {
  const store = await serverServices().backend.documents();
  return (documentsOf(await store.load("drones")) ?? []) as unknown as Drone[];
}

export async function loadRule(id: string) {
  return rulesRepo().findRule(id);
}

export async function activeRows(exceptId?: string) {
  return rulesRepo().activeRules(exceptId);
}

export async function rulesVersion() {
  return rulesRepo().rulesVersion();
}

export async function recordDecision(
  id: string,
  decision: DecisionKind,
  actor: DecisionActor,
  note: string | null = null,
) {
  await rulesRepo().recordDecision(id, decision, actor, note);
}

export async function bumpRuleVersion(note: string) {
  await rulesRepo().appendVersion(note);
  await getOrRefreshRuleSnapshot({ force: true });
}
