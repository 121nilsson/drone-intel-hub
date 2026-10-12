import type { Candidate, Drone } from "@/entities/drone/types";
import { phoneticKey } from "@/entities/drone/name-key";
import { ProviderOutageError, type Adjudicator } from "@/shared/contracts/ai";
import {
  learnedNegativeKeys,
  mergeInto,
  notASystemName,
  promote,
  type PipelineDeps,
} from "./pipeline";
import { evidenceFrom, outletKey } from "@/entities/source/outlet-record";

/**
 * Works the Queue so it does not need a person on it every day. Three rules, run after each
 * auto-sync, in this order:
 *
 * 1. CORROBORATION. A new system name the AI reported from two or more independent outlets is
 *    promoted (or merged, if the catalog meanwhile has it). Repetition across sources is better
 *    evidence than one model's confidence, which is what the single-post promote gate relies on.
 *    Outlets count by their measured precision (outlet-record.ts): a pair of outlets with a real
 *    track record carries the evidence bar, while two feeds that only ever repost fall below it.
 * 2. ADJUDICATION. A candidate the pipeline matched to a catalog entry with middling confidence is
 *    put to the deep model once, as a yes/no question about that one entry: merged on a confident
 *    yes, released as a new name on a confident no (so rule 1 can pick it up), left otherwise.
 * 3. AGE-OUT. A low-confidence candidate nobody corroborated within AGE_OUT_MS is discarded.
 *
 * Everything it resolves is marked `resolvedBy: "auto"`, so it never counts as an analyst's
 * rejection and never blocks a name for good.
 */

export const AGE_OUT_MS = 7 * 86_400_000;
/** Below this, an uncorroborated candidate is discarded once it is AGE_OUT_MS old. */
export const AGE_OUT_BELOW = 0.5;
/** Each report counted towards corroboration must be at least this confident. */
export const CORROBORATION_MIN_CONFIDENCE = 0.5;
export const CORROBORATING_OUTLETS = 2;
/**
 * Weighted evidence a corroborated name needs, on top of the distinct-outlet minimum. Outlets
 * weigh 0.5–1.5 by measured precision (NEUTRAL_WEIGHT = 1 when their record is unknown), so two
 * repost-only outlets (1.0) fall below this bar and two proven ones (up to 3.0) clear it.
 */
export const CORROBORATION_EVIDENCE = 2;
/** The deep model's answer must be at least this confident to act on. */
export const ADJUDICATION_CONFIDENCE = 0.8;
/** Adjudications per run, so triage cannot eat the extraction budget. */
export const MAX_ADJUDICATIONS = 10;

export interface TriageReport {
  corroborated: number;
  adjudicatedMerged: number;
  adjudicatedReleased: number;
  agedOut: number;
  /** Why adjudication stopped early, when it did. */
  stopReason?: string;
}

/** Reviewed by a model: a heuristic-only result has not had its identity checked. */
function aiReviewed(c: Candidate): boolean {
  const engine = c.extraction.metadata?.engine;
  return engine === "ai" || engine === "combined";
}

export async function autoTriage(
  d: Pick<PipelineDeps, "drones" | "candidates">,
  opts: {
    now?: number;
    adjudicate?: Adjudicator;
    maxAdjudications?: number;
    /** Outlet precision by phonetic key, from the dispatch archive (see outlet-record.ts). */
    outletWeights?: ReadonlyMap<string, number>;
  } = {},
): Promise<TriageReport> {
  const now = opts.now ?? Date.now();
  const report: TriageReport = {
    corroborated: 0,
    adjudicatedMerged: 0,
    adjudicatedReleased: 0,
    agedOut: 0,
  };
  const pending = () => d.candidates.list().filter((c) => c.status === "pending");
  const resolveAuto = (c: Candidate) => d.candidates.update(c.id, { resolvedBy: "auto" });

  // 2 runs before 1 so that a candidate the model releases as "not that entry" can be
  // corroborated in the same pass.
  if (opts.adjudicate) {
    const max = opts.maxAdjudications ?? MAX_ADJUDICATIONS;
    const borderline = pending()
      .filter(
        (c) =>
          !!c.extraction.matchId &&
          !c.adjudicatedAt &&
          c.extraction.confidence >= CORROBORATION_MIN_CONFIDENCE,
      )
      .slice(0, max);
    for (const c of borderline) {
      const target = d.drones.get(c.extraction.matchId!);
      if (!target) continue;
      let verdict: Awaited<ReturnType<Adjudicator>>;
      try {
        verdict = await opts.adjudicate(c, target);
      } catch (e) {
        // A provider outage would fail every remaining call too; anything else is this one.
        if (e instanceof ProviderOutageError) {
          report.stopReason = e.message;
          break;
        }
        d.candidates.update(c.id, { adjudicatedAt: new Date(now).toISOString() });
        continue;
      }
      const at = new Date(now).toISOString();
      if (verdict.confidence >= ADJUDICATION_CONFIDENCE && verdict.same) {
        mergeInto(c, target.id, d);
        d.candidates.update(c.id, { resolvedBy: "auto", adjudicatedAt: at });
        report.adjudicatedMerged++;
      } else if (verdict.confidence >= ADJUDICATION_CONFIDENCE && !verdict.same) {
        const { matchId: _dropped, ...extraction } = c.extraction;
        void _dropped;
        const note = `deep model: not ${target.name}${verdict.reason ? ` (${verdict.reason})` : ""}`;
        d.candidates.update(c.id, {
          adjudicatedAt: at,
          extraction: {
            ...extraction,
            rationale: extraction.rationale ? `${extraction.rationale} · ${note}` : note,
          },
        });
        report.adjudicatedReleased++;
      } else {
        d.candidates.update(c.id, { adjudicatedAt: at });
      }
    }
  }

  // 1. Corroboration.
  const groups = new Map<string, Candidate[]>();
  for (const c of pending()) {
    const name = c.extraction.name?.trim();
    if (!name || c.extraction.matchId || !aiReviewed(c)) continue;
    if (c.extraction.confidence < CORROBORATION_MIN_CONFIDENCE) continue;
    if (notASystemName(name, c.source)) continue;
    const key = phoneticKey(name);
    if (key.length < 3) continue;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const all = d.candidates.list();
  const suppressed = learnedNegativeKeys(all);
  for (const [key, group] of groups) {
    const outlets = new Set(group.map((c) => outletKey(c.source)));
    if (outlets.size < CORROBORATING_OUTLETS) continue;
    if (evidenceFrom(outlets, opts.outletWeights) < CORROBORATION_EVIDENCE) continue;
    if (suppressed.has(key)) continue;
    // The catalog may have gained the system since these were queued: merge rather than duplicate.
    const existing = d.drones
      .list()
      .find((x) => [x.name, x.cyrillic ?? "", ...x.aliases].some((n) => phoneticKey(n) === key));
    const best = [...group].sort((a, b) => b.extraction.confidence - a.extraction.confidence)[0]!;
    const targetId = existing?.id ?? promote(best, d).id;
    for (const c of group) {
      if (!existing && c.id === best.id) {
        resolveAuto(c);
        continue;
      }
      mergeInto(c, targetId, d);
      resolveAuto(c);
    }
    report.corroborated++;
  }

  // 3. Age-out.
  for (const c of pending()) {
    if (now - Date.parse(c.createdAt) < AGE_OUT_MS) continue;
    if (c.extraction.confidence >= AGE_OUT_BELOW) continue;
    d.candidates.update(c.id, { status: "discarded", resolvedBy: "auto" });
    report.agedOut++;
  }
  return report;
}
