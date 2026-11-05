import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { compileRuleSnapshot, ruleTerms } from "@/shared/contracts/rules";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { runSandbox, type SandboxResult } from "@/shared/infra/evaluation/sandbox";
import { newShadowMetrics } from "@/shared/infra/evaluation/autonomy";
import type { EvalFixture } from "@/shared/infra/evaluation/evaluation";
import type { Candidate, Drone } from "@/entities/drone/types";
import {
  activeRows,
  json,
  loadCatalog,
  loadRule,
  recordDecision,
  rulesVersion,
} from "@/shared/infra/evaluation/rule-sandbox-store.server";
import {
  candidateSample,
  candidatesMentioning,
  CONTROL_POOL,
  mergeById,
} from "@/shared/infra/evaluation/rule-sandbox-candidates.server";
import { loadFixtures } from "@/shared/infra/evaluation/rule-sandbox-fixtures.server";

/** Sandbox one rule against the active set. Records the verdict; never activates. */
export async function sandboxRule(
  id: string,
  mode: "fast" | "full" = "fast",
  world?: { drones: Drone[]; control: Candidate[]; fixtures: EvalFixture[] },
): Promise<{ ok: boolean; reason?: string; result?: SandboxResult }> {
  if (!dbConfigured()) return { ok: false, reason: "no database configured" };
  const rule = await loadRule(id);
  if (!rule) return { ok: false, reason: "rule not found" };
  const version = await rulesVersion();
  const active = await activeRows(id);
  const baselineRules = compileRuleSnapshot(active, version);
  const proposedRules = compileRuleSnapshot([...active, rule], version);
  if (proposedRules.invalid.includes(id)) return { ok: false, reason: "payload does not compile" };

  const drones = world?.drones ?? (await loadCatalog());
  const fixtures = world?.fixtures ?? (await loadFixtures(drones));
  const terms = ruleTerms(rule);
  const candidates = mergeById(
    await candidatesMentioning(terms),
    world?.control ?? (await candidateSample(CONTROL_POOL)),
  );
  const result = await runSandbox({
    fixtures,
    candidates,
    catalog: drones,
    baseline: new HeuristicExtractor(1, baselineRules),
    proposed: new HeuristicExtractor(1, proposedRules),
    terms,
    mode,
  });

  await db()`
    insert into rule_evaluations (rule_id, passed, corpus_size, regressions, broken_fixtures, f1_delta, mode, rules_version, report)
    values (${id}, ${result.passed}, ${result.corpusSize}, ${result.regressions.length},
      ${json(result.regressions.map((r) => r.id))}, ${result.f1Delta}, ${mode}, ${version}, ${json(result)})`;
  // Only a rule still awaiting a decision changes state; shadow and active rules keep theirs.
  // A generated rule that passes goes straight to shadow: it cannot affect production there,
  // and shadow is where it has to prove itself on reports it has never seen.
  const next = !result.passed
    ? "rejected"
    : rule.origin === "autonomous_sandbox"
      ? "shadow"
      : "candidate_passed";
  const [moved] = await db()`
    update dynamic_rules set status = ${next},
      shadow_metrics = ${next === "shadow" ? json(newShadowMetrics(new Date().toISOString())) : null}
    where id = ${id} and status in ('candidate', 'evaluating', 'candidate_passed')
    returning status`;
  if (moved && next === "rejected")
    await recordDecision(id, "rejected", "sandbox", result.reasons.join("; "));
  if (moved && next === "shadow") await recordDecision(id, "shadowed", "autonomous");
  return { ok: true, result };
}
