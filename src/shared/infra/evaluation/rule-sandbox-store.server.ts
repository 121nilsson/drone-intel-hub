import { db } from "@/shared/infra/postgres/db.server";
import { PostgresStore } from "@/shared/infra/postgres/postgres-store.server";
import { getOrRefreshRuleSnapshot } from "@/shared/infra/heuristics/rule-registry.server";
import { sanitizeJson } from "@/shared/infra/json-sanitize";
import { documentsOf } from "@/shared/contracts/store";
import type { DynamicRuleRow } from "@/shared/contracts/rules";
import type { DecisionActor, DecisionKind } from "@/shared/infra/evaluation/autonomy";
import type { Drone } from "@/entities/drone/types";
import type { JSONValue } from "postgres";

export const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
export const json = (v: unknown) => db().json(sanitizeJson(v as JSONValue));

export async function loadCatalog() {
  return (documentsOf(await new PostgresStore().load("drones")) ?? []) as unknown as Drone[];
}

export async function loadRule(id: string) {
  const [r] =
    await db()`select id, kind, language, payload, status, origin from dynamic_rules where id = ${id}`;
  return r ? (r as unknown as DynamicRuleRow & { status: string; origin: string }) : null;
}

export async function activeRows(exceptId?: string) {
  const rows =
    await db()`select id, kind, language, payload from dynamic_rules where status = 'active'`;
  return (rows as unknown as DynamicRuleRow[]).filter((r) => r.id !== exceptId);
}

export async function rulesVersion() {
  const [v] = await db()`select coalesce(max(version), 0)::int as v from dynamic_rules_version`;
  return Number(v?.["v"] ?? 0);
}

export async function recordDecision(
  id: string,
  decision: DecisionKind,
  actor: DecisionActor,
  note: string | null = null,
) {
  await db()`
    insert into rule_decisions (rule_id, category, origin, decision, actor, note)
    select id, kind || ':' || coalesce(target_key, '*'), origin, ${decision}, ${actor}, ${note}
    from dynamic_rules where id = ${id}`;
}

export async function bumpRuleVersion(note: string) {
  await db()`insert into dynamic_rules_version (version, note)
    select coalesce(max(version), 0) + 1, ${note} from dynamic_rules_version`;
  await getOrRefreshRuleSnapshot({ force: true });
}
