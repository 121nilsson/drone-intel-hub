import { serverServices } from "@/shared/infra/server-services.server";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { getOrRefreshRuleSnapshot } from "@/shared/infra/heuristics/rule-registry.server";
import { documentsOf } from "@/shared/contracts/store";
import type { Drone } from "@/entities/drone/types";
import { voidedByControls } from "@/entities/drone/audit";
import {
  emptySeedAgreement,
  readWith,
  scoreSeedAnswers,
  type SeedAnswerRow,
  type SeedAgreement,
} from "./seed-agreement";

/**
 * The server side of the seed-set measurement: it loads the answered seed rows from
 * `verification_audit` and scores today's heuristic (active rules included) against them.
 *
 * READ-ONLY on the seed set, and the only module that touches it outside the audit: the result
 * goes to the Evaluation page to be shown beside the scores. Nothing that learns may read the
 * seed set (plan §3, principle 7), so mining, shadow scoring, fixtures and promotion never import
 * this module.
 */
export async function seedAgreement(): Promise<
  SeedAgreement & { available: boolean; reason?: string }
> {
  try {
    // Every row, not only the seed's: a failed control voids the seed answers next to it, as it
    // voids audit answers (entities/drone/audit.ts), and the controls are not in the seed.
    const all = await serverServices().seedAudit.seedAuditRows();
    if (all === null)
      return { ...emptySeedAgreement(), available: false, reason: "no database configured" };
    const voided = voidedByControls(all);
    const rows = all.filter((r) => r.in_seed && r.answer !== null && !voided.has(r.id));
    if (!rows.length)
      return {
        ...emptySeedAgreement(),
        available: true,
        reason: "the seed set has no answers yet",
      };
    const answers: SeedAnswerRow[] = rows.map((r) => ({
      specKey: r.spec_key,
      specLabel: r.spec_label,
      value: r.value,
      ...(r.post_text ? { postText: r.post_text } : {}),
      answer: r.answer === "yes" || r.answer === "no" ? r.answer : "cannot_tell",
      ...(r.obviously_wrong ? { obviouslyWrong: true } : {}),
    }));
    const catalog = (documentsOf(
      await (await serverServices().backend.documents()).load("drones"),
    ) ?? []) as unknown as Drone[];
    const heuristic = new HeuristicExtractor(1, await getOrRefreshRuleSnapshot());
    const scored = await scoreSeedAnswers(answers, (text) => readWith(heuristic, catalog, text));
    return { ...scored, available: true };
  } catch (e) {
    return {
      ...emptySeedAgreement(),
      available: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
