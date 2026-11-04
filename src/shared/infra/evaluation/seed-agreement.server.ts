import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { PostgresStore } from "@/shared/infra/postgres/postgres-store.server";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { getOrRefreshRuleSnapshot } from "@/shared/infra/heuristics/rule-registry.server";
import { documentsOf } from "@/shared/contracts/store";
import type { Drone } from "@/entities/drone/types";
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
interface SeedDbRow {
  spec_key: string;
  spec_label: string;
  value: string;
  post_text: string | null;
  answer: string | null;
  obviously_wrong: boolean;
}

export async function seedAgreement(): Promise<
  SeedAgreement & { available: boolean; reason?: string }
> {
  if (!dbConfigured())
    return { ...emptySeedAgreement(), available: false, reason: "no database configured" };
  try {
    const rows = (await db()`
      select spec_key, spec_label, value, post_text, answer, obviously_wrong
      from verification_audit
      where in_seed and answer is not null
      order by drawn_at asc`) as unknown as SeedDbRow[];
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
    const catalog = (documentsOf(await new PostgresStore().load("drones")) ??
      []) as unknown as Drone[];
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
