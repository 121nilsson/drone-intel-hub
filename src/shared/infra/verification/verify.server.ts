import type { RawDispatch } from "@/entities/dispatch/types";
import { ANALYST_SOURCE } from "@/entities/drone/claim-review";
import type { Drone, SpecClaim } from "@/entities/drone/types";
import type { VerificationRunReport } from "@/shared/contracts/verification";
import { recordVerificationRunEvent } from "@/shared/infra/autonomy/ledger.server";
import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import { PostgresStore } from "@/shared/infra/postgres/postgres-store.server";
import { LocalDroneRepository } from "@/shared/infra/storage/local-repository";
import { needsVerification } from "./backfill";
import { runCatalogueVerification, verificationReport } from "./run";

/**
 * Deterministic verification on the server, against the whole archive.
 *
 * The browser holds only the newest posts (the store caps what it loads), so a run there judged
 * every claim from an older post "not in the archive" while its post was in the database. Here the
 * post text is read straight from the archive - only the posts the pending claims can come from,
 * so an hourly run over a settled catalogue reads almost nothing.
 *
 * Writes go through the drone repository, so each one carries the revision it read and a conflict
 * with an analyst's edit replays verification onto the stored copy instead of overwriting it.
 */

/** A claim this run must look at: a machine claim the current verifier has not judged. */
const pending = (c: SpecClaim) =>
  needsVerification(c) && c.source !== ANALYST_SOURCE && c.extractionEngine !== "analyst";

/** The URL a claim's "Outlet · URL" source names, which the backfill links unlinked claims by. */
const sourceUrl = (source: string) => {
  const at = source.lastIndexOf(" · ");
  return at >= 0 ? source.slice(at + 3).trim() : "";
};

interface PostRow {
  id: string;
  sourceName: string | null;
  url: string | null;
  text: string;
  contentHash: string | null;
}

/**
 * The posts the pending claims of `drones` can be checked against: each claim's own post, and
 * for a claim written without one, every post carrying its URL - all of them, so the backfill
 * still sees when a source names two posts and leaves that claim unlinked. A post whose text was
 * emptied (irrelevant, or a duplicate stub) is fetched only by its own id, and only when it still
 * carries a content hash: a stub shares its URL with the original post, so matching it by URL would
 * make a claim look ambiguous to the linker. It has no text to check against.
 */
export async function postsFor(drones: readonly Drone[]): Promise<RawDispatch[]> {
  const claims = drones.flatMap((d) => d.specs.flatMap((s) => s.claims.filter(pending)));
  const ids = [...new Set(claims.flatMap((c) => (c.sourceId ? [c.sourceId] : [])))];
  const urls = [
    ...new Set(claims.flatMap((c) => (c.sourceId ? [] : [sourceUrl(c.source)]).filter(Boolean))),
  ];
  if (!ids.length && !urls.length) return [];
  const rows = await db()<PostRow[]>`
    select id, data->>'sourceName' as "sourceName", data->>'url' as url, data->>'text' as text,
           content_hash as "contentHash"
      from dispatches
     where (coalesce(data->>'text', '') <> ''
            and (id = any(${ids}) or data->>'url' = any(${urls})))
        or (content_hash is not null and id = any(${ids}))`;
  return rows.map(
    (r) =>
      ({
        id: r.id,
        sourceName: r.sourceName ?? "",
        url: r.url ?? "",
        text: r.text,
        ...(r.contentHash ? { contentHash: r.contentHash } : {}),
      }) as RawDispatch,
  );
}

export async function runServerVerification(): Promise<VerificationRunReport> {
  if (!dbConfigured()) throw new Error("Server verification needs DATABASE_URL (PostgreSQL)");
  const drones = new LocalDroneRepository();
  await drones.attach(new PostgresStore());
  if (!drones.list().some((d) => d.specs.some((s) => s.claims.some(pending))))
    // Nothing for this verifier to judge: report the stored coverage, read nothing, write nothing.
    return verificationReport(drones.list(), {
      at: new Date().toISOString(),
      checked: 0,
      changed: 0,
      missingText: 0,
    });
  // In the browser the shell shows a rejected write; here nothing would, so the run collects them.
  const failures: string[] = [];
  const off = drones.onStorageError((message) => failures.push(message));
  try {
    const posts = await postsFor(drones.list());
    const report = await runCatalogueVerification(
      { drones, dispatches: { list: () => posts } },
      recordVerificationRunEvent,
    );
    // The writes are queued by the repository; the task is not done until they have landed.
    await drones.flush();
    if (failures.length)
      throw new Error(`${failures.length} write(s) failed: ${failures.slice(0, 3).join("; ")}`);
    return report;
  } finally {
    off();
  }
}
