import type { Drone, SpecClaim } from "@/entities/drone/types";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { ClaimTextResolver } from "@/entities/drone/verification";
import { VERIFIER_VERSION, verifyDrone } from "@/entities/drone/verification";
import type { DispatchRepository, DroneRepository } from "@/shared/contracts/repository";

/**
 * Bring stored verification up to the current verifier version.
 *
 * A claim is only re-checked when it has no verdict or the verdict was written by an older
 * verifier, so:
 * - a claim whose source post has scrolled out of the (bounded) archive is never downgraded by a
 *   later attach that can no longer find its text;
 * - repeated attaches are idempotent and rewrite nothing;
 * - bumping `VERIFIER_VERSION` is the single switch that re-runs the catalogue.
 */

/** Resolve a claim's own source text from the dispatch archive, by the id stored on the claim. */
export function dispatchTextResolver(dispatches: readonly RawDispatch[]): ClaimTextResolver {
  const byId = new Map(dispatches.map((d) => [d.id, d]));
  // An emptied post (irrelevant, or a duplicate stub) has no text to check against: undefined.
  return (claim) => (claim.sourceId ? byId.get(claim.sourceId)?.text || undefined : undefined);
}

/** The content hash of a claim's own post, from the post id stored on the claim. */
export function dispatchHashResolver(
  dispatches: readonly RawDispatch[],
): (claim: SpecClaim) => string | undefined {
  const byId = new Map(
    dispatches.flatMap((d) => (d.contentHash ? [[d.id, d.contentHash] as const] : [])),
  );
  return (claim) => (claim.sourceId ? byId.get(claim.sourceId) : undefined);
}

/**
 * Give each claim its post's content hash, where the claim has none yet. Only `lineage.contentHash`
 * is written: the rest of `lineage` is left as it is. Run before verification, so the source count
 * of a claim sees the hashes of its peers as well as its own.
 */
export function stampContentHashes(
  drone: Drone,
  hashFor: (claim: SpecClaim) => string | undefined,
): Drone {
  let changed = false;
  const specs = drone.specs.map((spec) => {
    let specChanged = false;
    const claims = spec.claims.map((claim) => {
      if (claim.lineage?.contentHash) return claim;
      const contentHash = hashFor(claim);
      if (!contentHash) return claim;
      specChanged = changed = true;
      return { ...claim, lineage: { ...claim.lineage, contentHash } };
    });
    return specChanged ? { ...spec, claims } : spec;
  });
  return changed ? { ...drone, specs } : drone;
}

/** The source string ingestion writes on a claim from an archived post (see auto-ingest). */
const postSource = (d: RawDispatch) => `${d.sourceName} · ${d.url}`;

/**
 * Find the archived post of a claim that was written without its id. Claims merged or promoted
 * from the intake queue used to lose the post id on the way, though their source string is the
 * post's own outlet and URL. Only a source that names exactly one post with text is linked; an
 * ambiguous one stays unlinked rather than checked against the wrong article.
 */
export function sourcePostLinker(
  dispatches: readonly RawDispatch[],
): (claim: SpecClaim) => string | undefined {
  const bySource = new Map<string, string | null>();
  for (const d of dispatches) {
    if (!d.text) continue;
    const key = postSource(d);
    bySource.set(key, bySource.has(key) ? null : d.id);
  }
  return (claim) => (claim.sourceId ? undefined : (bySource.get(claim.source) ?? undefined));
}

/** Stamp the post id on every claim the linker can place; the entry is returned as is otherwise. */
export function linkSourcePosts(
  drone: Drone,
  postFor: (claim: SpecClaim) => string | undefined,
): Drone {
  let changed = false;
  const specs = drone.specs.map((spec) => {
    let specChanged = false;
    const claims = spec.claims.map((claim) => {
      const sourceId = postFor(claim);
      if (!sourceId) return claim;
      specChanged = changed = true;
      return { ...claim, sourceId };
    });
    return specChanged ? { ...spec, claims } : spec;
  });
  return changed ? { ...drone, specs } : drone;
}

/** A claim the run should look at: never checked, or checked by an older verifier. */
export const needsVerification = (claim: SpecClaim) =>
  claim.verification?.verifierVersion !== VERIFIER_VERSION;

/** Whether a stored verdict was reached with the post in hand: its quote was looked up in it. */
const checkedAgainstPost = (claim: SpecClaim) =>
  claim.verification?.checks.some((c) => c.kind === "evidence_span" && c.verdict !== "uncertain");

/**
 * needsVerification, except that a claim whose verdict was reached against its post, and whose
 * post can no longer be found, keeps it: re-checking it without the text could only downgrade it
 * (evidence uncertain), so a verifier upgrade would read as a coverage drop it did not cause. That
 * covers a post pruned from the archive and a pasted text that was never archived, which ingest
 * verified against the paste. It stays on its older verifier version, visibly. A verdict that
 * never had the post loses nothing by being re-run, so it takes the current wording.
 */
export const reverifiable =
  (textFor: ClaimTextResolver) =>
  (claim: SpecClaim): boolean =>
    needsVerification(claim) && (!checkedAgainstPost(claim) || !!textFor(claim));

export interface BackfillResult {
  /** The catalogue with verification applied, entries unchanged where nothing changed. */
  drones: Drone[];
  /** Entries whose stored copy differs and must be written back. */
  changed: Drone[];
  /** Claims the run attempted (not already at the current version). */
  checked: number;
  /** Claims whose source post is not in the archive (checked without it, or kept as they were). */
  missingText: number;
}

/**
 * Pure: verify every outdated claim of every entry against its own source text. `catalog` is the
 * set the identity check compares against; it defaults to the entries being verified. `postFor`
 * links claims written without a post id to their post first, so they are checked against it.
 * `hashFor` stamps each claim with its post's content hash before anything is verified.
 */
export function backfillDrones(
  drones: readonly Drone[],
  textFor: ClaimTextResolver,
  catalog: readonly Drone[] = drones,
  at = new Date().toISOString(),
  postFor: (claim: SpecClaim) => string | undefined = () => undefined,
  hashFor: (claim: SpecClaim) => string | undefined = () => undefined,
): BackfillResult {
  let checked = 0;
  let missingText = 0;
  const changed: Drone[] = [];
  const shouldVerify = reverifiable(textFor);
  const next = drones.map((stored) => {
    const drone = stampContentHashes(linkSourcePosts(stored, postFor), hashFor);
    for (const spec of drone.specs)
      for (const claim of spec.claims) {
        if (!needsVerification(claim)) continue;
        if (claim.sourceId && !textFor(claim)) missingText++;
        if (shouldVerify(claim)) checked++;
      }
    const verified = verifyDrone(drone, textFor, catalog, at, shouldVerify);
    if (verified !== stored) changed.push(verified);
    return verified;
  });
  return { drones: next, changed, checked, missingText };
}

/** Entries verified between yields to the event loop. */
const CHUNK = 20;

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * The application entry point: run the backfill over live repositories and persist what changed.
 *
 * Each write carries a replay function, so a conflict with an analyst's concurrent edit reloads
 * the stored copy and applies verification to that instead of overwriting it.
 *
 * Chunked: a verifier upgrade re-checks every claim against the whole catalogue - seconds of work
 * on a real catalogue - and this runs in the browser at startup, so it yields between chunks and
 * writes each chunk as it goes instead of freezing the page until the end.
 */
export async function backfillCatalogue(deps: {
  drones: Pick<DroneRepository, "list" | "upsert">;
  dispatches: Pick<DispatchRepository, "list">;
}): Promise<BackfillResult> {
  const posts = deps.dispatches.list();
  const textFor = dispatchTextResolver(posts);
  const postFor = sourcePostLinker(posts);
  const hashFor = dispatchHashResolver(posts);
  const catalog = deps.drones.list();
  const replay = (fresh: Drone) =>
    verifyDrone(
      stampContentHashes(linkSourcePosts(fresh, postFor), hashFor),
      textFor,
      catalog,
      undefined,
      reverifiable(textFor),
    );
  const at = new Date().toISOString();
  const total: BackfillResult = { drones: [], changed: [], checked: 0, missingText: 0 };
  const ids = catalog.map((d) => d.id);
  for (let i = 0; i < ids.length; i += CHUNK) {
    if (i > 0) await yieldToEventLoop();
    // The live entries, not the snapshot: an edit made while this run yielded must be the copy
    // verification is applied to, or the write below would quietly put the old one back. The
    // snapshot stays the identity catalog, so its passage scans are reused across chunks.
    const live = new Map(deps.drones.list().map((d) => [d.id, d]));
    const chunk = ids.slice(i, i + CHUNK).flatMap((id) => {
      const d = live.get(id);
      return d ? [d] : [];
    });
    const part = backfillDrones(chunk, textFor, catalog, at, postFor, hashFor);
    for (const drone of part.changed) deps.drones.upsert(drone, replay);
    total.drones.push(...part.drones);
    total.changed.push(...part.changed);
    total.checked += part.checked;
    total.missingText += part.missingText;
  }
  return total;
}
