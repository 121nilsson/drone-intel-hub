import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { PostgresStore } from "@/shared/infra/postgres/postgres-store.server";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { getOrRefreshRuleSnapshot } from "@/shared/infra/heuristics/rule-registry.server";
import { normalizeExtraction } from "@/entities/normalization/apply";
import { sanitizeJson } from "@/shared/infra/json-sanitize";
import { documentsOf } from "@/shared/contracts/store";
import {
  comparableSpecs,
  compareSpecs,
  verifiedReference,
  verifiedVerdicts,
  type EvalFixture,
} from "@/shared/infra/evaluation/evaluation";
import type { JSONValue } from "postgres";
import type { Candidate, Drone } from "@/entities/drone/types";
import { readProviderEnvConfig } from "@/shared/infra/provider-env.server";
import { trustState, type TrustState, type TrustTally } from "@/shared/infra/ingest/earned-trust";
import { chatCompletionOnce } from "@/shared/infra/ai-proxy.server";
import { claimLock, releaseLock } from "@/shared/infra/evaluation/evaluation-lock.server";

export interface AdjudicationResult {
  ran: boolean;
  reason: string;
  adjudicated: number;
  inserted: number;
}

/** Step 2: adjudicate mismatches via AI (max 10 per run). */
export async function runAdjudication(): Promise<{
  ran: boolean;
  reason: string;
  adjudicated: number;
  inserted: number;
}> {
  if (!dbConfigured())
    return { ran: false, reason: "no database configured", adjudicated: 0, inserted: 0 };
  const env = await (await import("@/shared/infra/provider-env.server")).readProviderEnvConfig();
  if (!env.hasKey) return { ran: false, reason: "no AI provider key", adjudicated: 0, inserted: 0 };

  const lock = await claimLock();
  if (!lock.ok) return { ran: false, reason: lock.reason, adjudicated: 0, inserted: 0 };

  try {
    const store = new PostgresStore();
    const drones = (documentsOf(await store.load("drones")) ?? []) as unknown as Drone[];
    const candidates = (documentsOf(await store.load("candidates")) ??
      []) as unknown as Candidate[];
    const heuristic = new HeuristicExtractor(1, await getOrRefreshRuleSnapshot());
    const { chatCompletionOnce } = await import("@/shared/infra/ai-proxy.server");

    let adjudicated = 0;
    let inserted = 0;
    const MAX = 10;
    // A positive fixture from the model's pick is approved on its own only while analysts have
    // earned the adjudicator that trust; otherwise it waits in "pending" for a person, and
    // approvals made on its own are handed back when the trust is gone.
    const trust = await adjudicationTrust();
    const autoApprove = trust.state === "earned";
    if (!autoApprove) await revokeAutonomousApprovals();
    const positiveStatus = autoApprove ? "approved" : "pending";
    const decidedBy = autoApprove ? "autonomous" : null;
    // A claim an analyst ruled on is settled: it compares as dropped or confirmed, never as a
    // conflict to put to the model.
    const verdicts = verifiedVerdicts(drones);
    // The fixture ids the adjudication writes are deterministic, so a conflict that was already
    // judged can be recognised and left to the model no more. They are read in one query: the
    // candidate list is thousands long, and a query per candidate would be thousands of round
    // trips to learn what a set lookup answers.
    const judged = new Set(
      (await db()`select id from eval_corpus where id like 'adj-%'`).map((r) => r["id"] as string),
    );

    for (const c of candidates) {
      if (adjudicated >= MAX) break;
      if (!c.raw || c.raw.trim().length < 50) continue;
      const heur = normalizeExtraction(await heuristic.extract(c.raw, drones)).extraction;
      const cmp = compareSpecs(comparableSpecs(heur), verifiedReference(c, verdicts));
      const conflicts = [...cmp.wrongKeys, ...cmp.falsePositives.map((h) => ({ h, r: null }))];
      if (conflicts.length === 0) continue;

      for (const conf of conflicts) {
        if (adjudicated >= MAX) break;
        const h = conf.h;
        const r = conf.r;
        // The model is only asked about a conflict no fixture covers yet. The id the verdict
        // would be filed under is deterministic, so this is exact: the same disagreement is
        // never put to the model twice, while a different disagreement in the same report
        // still is.
        if (
          judged.has(`adj-${c.id}-${h.semantic}`) ||
          (r && judged.has(`adj-${c.id}-${r.semantic}`))
        )
          continue;
        const prompt = `You are an OSINT adjudicator. A heuristic extractor and an AI extractor disagree on a spec.\n\nRaw text:\n${c.raw.slice(0, 1500)}\n\nHeuristic says: ${h.semantic} = ${h.value} ${h.unit ?? ""}\nAI says: ${r ? `${r.semantic} = ${r.value} ${r.unit ?? ""}` : "(no value)"}\n\nWhich is better supported by the text? Answer only one of: heuristic, ai, neither.`;
        const res = await chatCompletionOnce({
          model: env.tier2Model ?? "gpt-4o",
          json: false,
          system:
            "You are a precise OSINT adjudicator. Answer only one word: heuristic, ai, or neither.",
          prompt,
          tier: "tier2",
        });
        if (!res.ok) continue;
        const answer = res.content.trim().toLowerCase();
        adjudicated++;

        if (answer === "heuristic") {
          const fx: EvalFixture = {
            id: `adj-${c.id}-${h.semantic}`,
            source: c.source,
            text: c.raw,
            expect: [
              {
                semantic: h.semantic,
                value: h.canonical ?? h.value,
                ...(h.canonicalUnit ? { unit: h.canonicalUnit } : {}),
              },
            ],
            status: "pending",
          };
          await db()`insert into eval_corpus (id, version, kind, fixture, status, origin, observed_at, decided_at, decided_by)
            values (${fx.id}, 1, 'positive', ${db().json(sanitizeJson({ ...fx, status: positiveStatus } as unknown as JSONValue))}, ${positiveStatus}, 'adjudication', now(), ${decidedBy ? new Date() : null}, ${decidedBy})
            on conflict (id, version) do nothing`;
          judged.add(fx.id);
          inserted++;
        } else if (answer === "ai" && r) {
          const fx: EvalFixture = {
            id: `adj-${c.id}-${r.semantic}`,
            source: c.source,
            text: c.raw,
            expect: [
              {
                semantic: r.semantic,
                value: r.canonical ?? r.value,
                ...(r.canonicalUnit ? { unit: r.canonicalUnit } : {}),
              },
            ],
            status: "pending",
          };
          await db()`insert into eval_corpus (id, version, kind, fixture, status, origin, observed_at, decided_at, decided_by)
            values (${fx.id}, 1, 'positive', ${db().json(sanitizeJson({ ...fx, status: positiveStatus } as unknown as JSONValue))}, ${positiveStatus}, 'adjudication', now(), ${decidedBy ? new Date() : null}, ${decidedBy})
            on conflict (id, version) do nothing`;
          judged.add(fx.id);
          inserted++;
          // negative against heuristic's value
          const neg: EvalFixture = {
            id: `adj-neg-${c.id}-${h.semantic}`,
            source: c.source,
            text: c.raw,
            expect: [],
            forbid: [
              {
                semantic: h.semantic,
                value: h.canonical ?? h.value,
                ...(h.canonicalUnit ? { unit: h.canonicalUnit } : {}),
              },
            ],
            status: "pending_fix",
            // origin stored in DB column, not fixture
          };
          await db()`insert into eval_corpus (id, version, kind, fixture, status, origin, observed_at)
            values (${neg.id}, 1, 'negative', ${db().json(sanitizeJson(neg as unknown as JSONValue))}, 'pending_fix', 'adjudication', now())
            on conflict (id, version) do nothing`;
        }
      }
    }

    return { ran: true, reason: "ok", adjudicated, inserted };
  } catch (e) {
    return {
      ran: false,
      reason: e instanceof Error ? e.message : String(e),
      adjudicated: 0,
      inserted: 0,
    };
  } finally {
    await releaseLock().catch(() => {});
  }
}

/** Analyst decisions on AI-adjudicated positive fixtures: an approval agrees with the model. */
export async function adjudicationTrust(): Promise<TrustTally & { state: TrustState }> {
  const empty = { agreed: 0, disagreed: 0 };
  if (!dbConfigured()) return { ...empty, state: trustState(empty) };
  const rows = await db()`
    select status, count(*)::int as n from eval_corpus
    where origin = 'adjudication' and kind = 'positive' and decided_by = 'analyst'
      and status in ('approved', 'rejected')
    group by status`;
  const count = (s: string) => (rows.find((r) => r["status"] === s)?.["n"] as number) ?? 0;
  const t = { agreed: count("approved"), disagreed: count("rejected") };
  return { ...t, state: trustState(t) };
}

/** Approvals the adjudicator made on its own go back to "pending" once it lost the trust. */
export async function revokeAutonomousApprovals() {
  await db()`
    update eval_corpus set status = 'pending', decided_at = null, decided_by = null
    where origin = 'adjudication' and decided_by = 'autonomous' and status = 'approved'`;
}
