import { replayTargets } from "@/entities/drone/claim-lineage";
import { recordAutonomyEvent } from "@/shared/infra/autonomy/ledger.server";
import { autonomySwitchEnabled } from "@/shared/infra/autonomy/switches.server";
import { ruleCategory } from "@/shared/infra/evaluation/autonomy";
import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { PostgresStore } from "@/shared/infra/postgres/postgres-store.server";
import {
  LocalDispatchRepository,
  LocalDroneRepository,
} from "@/shared/infra/storage/local-repository";

/** Posts one quarantine may hand back for re-analysis. The rest are counted in the ledger reason. */
export const REPLAY_MAX_POSTS = 200;

/** Kinds that leave claim lineage. Stopwords and unit scales leave none, so they replay nothing. */
const REPLAYABLE = new Set(["add_cue", "context_filter", "add_alias"]);

export interface ReplayResult {
  /** Claims the rule shaped that were found. */
  claims: number;
  /** Posts handed back to the pipeline, pending and marked for re-analysis. */
  requeued: string[];
  /** Why part of the replay did not happen; empty when all of it did. */
  skipped: string;
}

const EMPTY = (skipped: string): ReplayResult => ({ claims: 0, requeued: [], skipped });

/** Reads an add_alias payload the way compileRuleSnapshot does, so the same rules are replayed. */
function aliasOf(payload: unknown): { droneId: string; aliases: string[] } | null {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const rawId = p["droneId"] ?? p["targetDroneId"];
  const droneId = typeof rawId === "string" ? rawId.trim() : "";
  const rawAlias = p["alias"];
  const alias = typeof rawAlias === "string" ? rawAlias.trim() : "";
  if (!droneId || alias.length <= 2) return null;
  return { droneId, aliases: [alias] };
}

/**
 * Re-analyse the posts a just-quarantined rule shaped, so they are read again without it.
 *
 * A quarantined rule stops affecting future extractions only; the claims it already produced stay
 * in the catalogue. Here each such post is handed back to the pipeline as pending with
 * `reanalyze`, which retracts its machine claims and re-reads it. Analyst reviews are restored.
 *
 * Called after the status change and the rule-version bump, so the re-read runs without the rule.
 * Never throws: a failure is logged and returned in `skipped`, and the quarantine stands.
 */
export async function replayRule(ruleId: string): Promise<ReplayResult> {
  if (!autonomySwitchEnabled("rule_replay") || !dbConfigured())
    return EMPTY("switched off or no database");
  try {
    const [row] =
      await db()`select id, kind, payload, target_key from dynamic_rules where id = ${ruleId}`;
    if (!row) return EMPTY("no such rule");
    const kind = row["kind"] as string;
    const targetKey = (row["target_key"] as string | null) ?? null;
    if (!REPLAYABLE.has(kind)) return EMPTY(`${kind} leaves no claim lineage`);
    const alias = kind === "add_alias" ? aliasOf(row["payload"]) : null;
    if (kind === "add_alias" && !alias) return EMPTY("alias payload has no drone or term");

    const drones = new LocalDroneRepository();
    await drones.attach(new PostgresStore());
    const { claimIds, dispatchIds } = replayTargets(drones.list(), {
      ruleId,
      ...(alias ? { alias } : {}),
    });
    if (!claimIds.length) return EMPTY("no claims shaped by this rule");

    const capped = dispatchIds.slice(0, REPLAY_MAX_POSTS);
    const overflow = dispatchIds.length - capped.length;

    // The archive is larger than the cache window, so the posts are loaded by id first (the
    // revision of each is then the one this write is based on, see CachedRepository.persist).
    const dispatches = new LocalDispatchRepository();
    const failures: string[] = [];
    await dispatches.attach(new PostgresStore());
    const off = dispatches.onStorageError((message) => failures.push(message));
    let requeued: string[] = [];
    try {
      await dispatches.preload(capped);
      const byId = new Map(dispatches.list().map((d) => [d.id, d]));
      requeued = capped.filter((id) => {
        const d = byId.get(id);
        // Irrelevant and duplicate posts keep no text, so there is nothing to re-read.
        return !!d && d.text.trim() !== "" && d.status !== "pending";
      });
      for (const id of requeued)
        dispatches.update(id, {
          status: "pending",
          attempts: 0,
          error: undefined,
          reanalyze: true,
        });
      // The write is queued by the repository; the replay is not done until it has landed.
      await dispatches.flush();
    } finally {
      off();
    }

    const notes = [
      `${requeued.length} of ${dispatchIds.length} post(s) queued for re-analysis without the rule`,
      ...(overflow > 0
        ? [`${overflow} more over the ${REPLAY_MAX_POSTS} cap were not replayed`]
        : []),
      ...(failures.length
        ? [`${failures.length} write(s) failed: ${failures.slice(0, 3).join("; ")}`]
        : []),
    ];
    await recordAutonomyEvent({
      action: "rule_replay_requested",
      actor: "rule-sandbox:replay",
      actorKind: "system",
      targetCollection: "dynamic_rules",
      targetId: ruleId,
      category: ruleCategory(kind, targetKey),
      before: { claims: claimIds.length, claimIds: claimIds.slice(0, 50) },
      after: { dispatchIds: requeued },
      reason: notes.join("; "),
      reversible: false,
    });
    return {
      claims: claimIds.length,
      requeued,
      skipped: [
        ...(overflow > 0 ? [`${overflow} over the cap`] : []),
        ...(failures.length ? ["write failed"] : []),
      ].join("; "),
    };
  } catch (e) {
    console.error("[evaluation:rules] replay failed for", ruleId, e);
    return EMPTY(e instanceof Error ? e.message : String(e));
  }
}
