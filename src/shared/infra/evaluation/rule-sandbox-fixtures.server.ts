import { db } from "@/shared/infra/postgres/db.server";
import {
  queueFixtures,
  verifiedFixtures,
  verifiedVerdicts,
  type EvalFixture,
} from "@/shared/infra/evaluation/evaluation";
import type { Drone } from "@/entities/drone/types";
import {
  analystResolvedCandidates,
  judgedCandidates,
} from "@/shared/infra/evaluation/rule-sandbox-candidates.server";
import fs from "node:fs";
import path from "node:path";

/**
 * Approved + pending_fix fixtures: latest DB version per id, then git files not in the DB, then
 * the fixtures derived live and never stored: Queue decisions (queueFixtures) and the catalogue's
 * verified claims (verifiedFixtures - analyst verdicts keep their "review-" ids, machine
 * verification gets "verified-").
 */
export async function loadFixtures(drones: readonly Drone[]): Promise<EvalFixture[]> {
  const rows = await db()`
    select distinct on (id) id, status, fixture from eval_corpus
    order by id, version desc`;
  const byId = new Map<string, EvalFixture>();
  for (const r of rows) {
    const status = r["status"] as string;
    if (status !== "approved" && status !== "pending_fix") continue;
    const fx = r["fixture"] as EvalFixture;
    byId.set(r["id"] as string, { ...fx, status });
  }
  for (const p of [
    "src/test/fixtures/eval-corpus.json",
    "src/test/fixtures/eval-mismatches.json",
  ]) {
    const full = path.resolve(process.cwd(), p);
    if (!fs.existsSync(full)) continue;
    for (const fx of JSON.parse(fs.readFileSync(full, "utf8")) as EvalFixture[])
      if (!byId.has(fx.id)) byId.set(fx.id, fx);
  }
  const verdicts = verifiedVerdicts(drones);
  for (const fx of queueFixtures(await analystResolvedCandidates(), verdicts)) byId.set(fx.id, fx);
  for (const fx of verifiedFixtures(await judgedCandidates(drones), verdicts)) byId.set(fx.id, fx);
  return [...byId.values()].filter((f) => typeof f.text === "string" && f.text.length > 0);
}
