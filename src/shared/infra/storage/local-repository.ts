import type { Candidate, Drone } from "@/entities/drone/types";
import { ensureClaimIds } from "@/entities/drone/claim-review";
import { ACTIVE_SEED_DRONES, SEED_DRONES } from "@/entities/drone/seed";
import { isNearDuplicate, simHash64 } from "@/entities/dispatch/simhash";
import { canonicalUrl } from "@/entities/dispatch/url-key";
import type { MonitoredSource } from "@/entities/source/types";
import { ACTIVE_SEED_SOURCES, SEED_SOURCES } from "@/entities/source/seed";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { Procurement } from "@/entities/procurement/types";
import { procurementDedupeKey } from "@/entities/procurement/routing";
import {
  effectiveInstallationId,
  effectivePropulsionId,
  resolveTerm,
  SEEDED_TERMS,
  storedTerm,
  type StoredTaxonomyTerm,
  type TaxonomyCandidate,
} from "@/entities/normalization/taxonomy";
import {
  detectProtocols,
  effectiveIeeeBands,
  effectiveNatoBands,
  linkIsFiber,
} from "@/entities/normalization/rf";
import type {
  TaxonomyCandidateRepository,
  TaxonomyRepository,
  TaxonomySourceRef,
} from "@/shared/contracts/taxonomy";
import type {
  DispatchRepository,
  SourceRepository,
  CandidateRepository,
  CatalogFacets,
  DroneRepository,
  Subscribable,
} from "@/shared/contracts/repository";
import {
  DocumentConflictError,
  type Collection,
  type CollectionMap,
  type DocumentStore,
  type VersionedDoc,
} from "@/shared/contracts/store";

const norm = (s: string) => s.toLowerCase().normalize("NFKD");

/** Newest dispatches only: a duplicate almost always lands in the current or the next sync. */
const DUP_SCAN_WINDOW = 2000;

export function droneHaystack(d: Drone) {
  return norm(
    [
      d.name,
      d.cyrillic ?? "",
      ...d.aliases,
      d.manufacturer ?? "",
      ...d.components.map((c) => `${c.manufacturer} ${c.part}`),
    ].join(" | "),
  );
}

/**
 * Write-through cache: synchronous reads for the UI, async persistence to any DocumentStore.
 * Swapping storage = attaching a different store; features never change.
 */
type Replay<T> = (fresh: T) => T;

abstract class CachedRepository<C extends Collection> implements Subscribable {
  private fns = new Set<() => void>();
  private problemFns = new Set<(message: string) => void>();
  protected store: DocumentStore | null = null;
  /** Revision of each document in `items`, as last read from or written to the store. */
  protected revs = new Map<string, number>();
  /**
   * Per-document write chains. Two writes to the same document must run in order: the second
   * has to use the revision the first returned, or it would conflict with its own predecessor.
   */
  private writes = new Map<string, Promise<void>>();
  private inflight = new Set<Promise<void>>();
  constructor(
    protected collection: C,
    protected items: CollectionMap[C][],
  ) {}
  subscribe(fn: () => void) {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  }
  protected emit() {
    this.fns.forEach((f) => f());
  }

  /**
   * Failures the UI has to know about: a write the store refused, a conflict whose edit could
   * not be saved, or a delete that did not happen. Kept separate from `subscribe` because a
   * storage problem must survive the cache reload that follows it.
   */
  onStorageError(fn: (message: string) => void) {
    this.problemFns.add(fn);
    return () => {
      this.problemFns.delete(fn);
    };
  }

  private reportProblem(message: string, cause?: unknown) {
    const detail =
      cause === undefined
        ? message
        : `${message} (${cause instanceof Error ? cause.message : String(cause)})`;
    console.error(`[store] ${detail}`, cause ?? "");
    this.problemFns.forEach((fn) => {
      try {
        fn(detail);
      } catch (e) {
        // A UI listener must not break persistence or another listener.
        console.error("[store] storage-error listener failed", e);
      }
    });
  }

  /**
   * A failed write may have advanced a revision or may have landed despite the error. Reload the
   * stored truth so the cache does not keep showing an edit that was not saved; if even the
   * reload fails, the warning above is all the UI can trust.
   */
  private async recoverAfterFailure(message: string, cause: unknown) {
    this.reportProblem(message, cause);
    try {
      await this.reload();
    } catch (e) {
      this.reportProblem(`could not reload ${this.collection}`, e);
    }
  }

  /** Replace the cache with a store snapshot, revisions included. */
  protected adopt(loaded: VersionedDoc<CollectionMap[C]>[]) {
    this.items = loaded.map((entry) => entry.doc);
    this.revs = new Map(loaded.map((entry) => [entry.doc.id, entry.rev]));
  }

  async attach(store: DocumentStore) {
    // Load and seed before switching the pointer: a failed attach must leave the repository on
    // its previous store, never half-attached to one that cannot read or write it.
    const loaded = await store.load(this.collection);
    if (loaded === null) {
      await store.seed(this.collection, this.items);
      this.store = store;
      this.revs = new Map(this.items.map((doc) => [doc.id, 0]));
    } else {
      this.adopt(loaded);
      this.store = store;
      this.emit();
    }
  }

  /**
   * Re-read this collection. A null load is left as-is so a missing collection is not reseeded
   * the way attach() would. `apply` runs after the read so a caller can drop a snapshot that
   * went stale while the load was in flight.
   */
  async reload(apply: () => boolean = () => true) {
    if (!this.store) return;
    const loaded = await this.store.load(this.collection);
    if (!loaded || !apply()) return;
    this.adopt(loaded);
    this.emit();
  }

  /** Wait until every queued write and delete for this repository has settled. */
  async flush() {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  /**
   * Persist a document the caller has already placed in `items`.
   *
   * `replay` is what makes a conflict recoverable: after another writer changes the stored
   * copy, it receives the fresh document and returns the change applied to it. Callers that
   * cannot reapply their edit should omit it - the cache is then reloaded, so the user sees
   * the stored truth rather than an edit that was silently thrown away.
   */
  protected save(doc: CollectionMap[C], replay?: Replay<CollectionMap[C]>) {
    this.emit();
    const store = this.store;
    if (!store) return;
    this.track(store, doc, replay);
  }

  private track(store: DocumentStore, doc: CollectionMap[C], replay?: Replay<CollectionMap[C]>) {
    const previous = this.writes.get(doc.id) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => this.persist(store, doc, replay))
      .catch((e) => this.reportProblem(`could not save ${this.collection}`, e));
    this.writes.set(doc.id, next);
    this.inflight.add(next);
    void next.finally(() => {
      if (this.writes.get(doc.id) === next) this.writes.delete(doc.id);
      this.inflight.delete(next);
    });
  }

  private async persist(
    store: DocumentStore,
    doc: CollectionMap[C],
    replay?: Replay<CollectionMap[C]>,
  ) {
    let candidate = doc;
    for (let attempt = 0; attempt < 3; attempt++) {
      const expected = this.revs.get(candidate.id) ?? null;
      try {
        const rev = await store.put(this.collection, candidate, expected);
        this.revs.set(candidate.id, rev);
        return;
      } catch (e) {
        if (!(e instanceof DocumentConflictError)) {
          await this.recoverAfterFailure(`could not save ${this.collection}/${candidate.id}`, e);
          return;
        }
        await this.reload();
        const fresh = this.items.find((x) => x.id === candidate.id);
        if (!replay || !fresh) {
          this.reportProblem(
            `${this.collection}/${candidate.id} changed in another session; your edit was reloaded, not saved`,
          );
          return;
        }
        candidate = replay(fresh);
        // Only replace the optimistic copy if it is still the one this write was based on; a
        // newer local edit belongs to the next write in the chain.
        const current = this.items.find((x) => x.id === candidate.id);
        if (current === doc || current === fresh) {
          this.items = this.items.map((x) => (x.id === candidate.id ? candidate : x));
          this.emit();
        }
      }
    }
    this.reportProblem(
      `${this.collection}/${doc.id} kept changing in other sessions; the stored copy was reloaded`,
    );
    await this.reload();
  }

  protected drop(id: string) {
    this.emit();
    const store = this.store;
    if (!store) {
      this.revs.delete(id);
      return;
    }
    const previous = this.writes.get(id) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        await store.remove(this.collection, id);
        // Keep the revision until the delete has actually run: a save queued before this drop
        // still has to update the existing document, and a save queued after it must insert.
        this.revs.delete(id);
      })
      .catch((e) => this.recoverAfterFailure(`could not delete ${this.collection}/${id}`, e));
    this.writes.set(id, next);
    this.inflight.add(next);
    void next.finally(() => {
      if (this.writes.get(id) === next) this.writes.delete(id);
      this.inflight.delete(next);
    });
  }

  list() {
    return this.items;
  }
}

export class LocalDroneRepository extends CachedRepository<"drones"> implements DroneRepository {
  constructor() {
    super("drones", SEED_DRONES);
  }
  /**
   * Backfill identities for catalogs written before `SpecClaim.id` existed. One write per affected
   * entry, immediately after load, so a review given later always has a stable key to refer to.
   */
  override async attach(store: DocumentStore) {
    await super.attach(store);
    const normalized = this.items.map((drone) => ensureClaimIds(drone));
    const changed = normalized.filter((drone, i) => drone !== this.items[i]);
    if (!changed.length) return;
    this.items = normalized;
    for (const drone of changed) this.save(drone);
  }
  get(id: string) {
    return this.items.find((d) => d.id === id);
  }
  upsert(drone: Drone, replay?: (fresh: Drone) => Drone) {
    const i = this.items.findIndex((d) => d.id === drone.id);
    this.items =
      i >= 0 ? this.items.map((d) => (d.id === drone.id ? drone : d)) : [...this.items, drone];
    this.save(drone, replay);
  }
  remove(id: string) {
    this.items = this.items.filter((d) => d.id !== id);
    this.drop(id);
  }
  /**
   * Seed entries the catalog does not have yet, the counterpart of the Sources page's "Load
   * default sources". Manual on purpose: an analyst who merged or deleted a seeded system
   * decided it does not belong, and no background process may put it back - an automatic
   * version of this once ran on every load and undid merges, resurrecting a merged-away
   * saab-giraffe-1x every time the page was reloaded.
   */
  addMissingDefaults(): number {
    const existingIds = new Set(this.items.map((d) => d.id));
    const missing = ACTIVE_SEED_DRONES.filter((d) => !existingIds.has(d.id));
    for (const d of missing) {
      this.items = [...this.items, d];
      this.save(d);
    }
    this.emit();
    return missing.length;
  }
  search(query: string, f: CatalogFacets = {}) {
    const q = norm(query.trim());
    return this.items.filter((d) => {
      if (q && !droneHaystack(d).includes(q)) return false;
      if (f.domains?.length && !f.domains.includes(d.domain)) return false;
      if (f.origin?.length && !f.origin.includes(d.origin)) return false;
      if (f.operators?.length && !d.operators.some((o) => f.operators!.includes(o))) return false;
      if (f.bands?.length && !d.rf.some((r) => f.bands!.includes(r.band))) return false;
      if (f.propulsion?.length && !f.propulsion.includes(d.propulsion)) return false;
      if (
        f.ieeeBands?.length &&
        !d.rf.some((r) => effectiveIeeeBands(r).some((b) => f.ieeeBands!.includes(b)))
      )
        return false;
      if (
        f.natoBands?.length &&
        !d.rf.some((r) => effectiveNatoBands(r).some((b) => f.natoBands!.includes(b)))
      )
        return false;
      if (f.propulsionIds?.length) {
        const id = effectivePropulsionId(d);
        if (!id || !f.propulsionIds.includes(id)) return false;
      }
      if (f.installationIds?.length) {
        const id = effectiveInstallationId(d);
        if (!id || !f.installationIds.includes(id)) return false;
      }
      if (
        f.protocols?.length &&
        !d.rf.some((r) => {
          const ids = r.protocols?.length
            ? r.protocols
            : detectProtocols(`${r.band} ${r.notes ?? ""}`);
          return ids.some((p) => f.protocols!.includes(p));
        })
      )
        return false;
      if (f.fiberOnly && !d.rf.some((r) => linkIsFiber(r))) return false;
      return true;
    });
  }
}

export class LocalCandidateRepository
  extends CachedRepository<"candidates">
  implements CandidateRepository
{
  constructor() {
    super("candidates", []);
  }
  add(c: Candidate) {
    this.items = [c, ...this.items];
    this.save(c);
  }
  update(id: string, patch: Partial<Candidate>) {
    this.items = this.items.map((c) => (c.id === id ? { ...c, ...patch } : c));
    const doc = this.items.find((c) => c.id === id);
    if (doc) this.save(doc, (fresh) => ({ ...fresh, ...patch }));
  }
}

export class LocalSourceRepository extends CachedRepository<"sources"> implements SourceRepository {
  constructor() {
    super("sources", SEED_SOURCES);
  }
  add(s: MonitoredSource) {
    this.items = [s, ...this.items];
    this.save(s);
  }
  update(id: string, patch: Partial<MonitoredSource>) {
    this.items = this.items.map((x) => (x.id === id ? { ...x, ...patch } : x));
    const doc = this.items.find((x) => x.id === id);
    if (doc) this.save(doc, (fresh) => ({ ...fresh, ...patch }));
  }
  remove(id: string) {
    this.items = this.items.filter((x) => x.id !== id);
    this.drop(id);
  }
  addMissingDefaults(): number {
    const existingIds = new Set(this.items.map((s) => s.id));
    const missing = ACTIVE_SEED_SOURCES.filter((s) => !existingIds.has(s.id));
    for (const s of missing) {
      this.items = [...this.items, s];
      this.save(s);
    }
    this.emit();
    return missing.length;
  }
}

export class LocalDispatchRepository
  extends CachedRepository<"dispatches">
  implements DispatchRepository
{
  /**
   * Near-duplicate index. A dispatch's text is fingerprinted the first time it is looked at, so
   * documents stored before the fingerprint column existed need no backfill, and the check stays
   * a memory lookup rather than a query against every store.
   *
   * In-memory is enough because this repository already holds the working set (the stores cap the
   * dispatches they return), and because the cache is refreshed on attach(), which is where a
   * stale index would otherwise survive.
   */
  private fingerprints = new Map<string, string>();
  private fingerprintIds = new Map<string, string>();

  /**
   * Canonical-URL index, the deterministic half of dedupe.
   *
   * SimHash answers "are these the same story?" by comparing text, which is the right question for
   * a reprint but the wrong one for the same article arriving from two feeds: those copies can
   * differ in length and wording, and the near-match tolerance decides it by luck. A shared URL is
   * identity, not resemblance, so it gets its own exact index.
   *
   * Keyed on `canonicalUrl` (see entities/dispatch/url-key.ts). Only documents that still carry a
   * URL are indexed; a stub has its text stripped but keeps its URL, which is the point - a
   * duplicate stub must keep pointing at the same article so a third copy resolves to the
   * canonical post rather than to another stub.
   */
  private urlKeys = new Map<string, string>();
  private urlKeyIds = new Map<string, string>();

  constructor() {
    super("dispatches", []);
  }
  has(id: string) {
    return this.items.some((d) => d.id === id);
  }
  add(d: RawDispatch) {
    if (this.has(d.id)) return false;
    this.items = [d, ...this.items];
    // Registering here is what catches a second copy of the same post *within one batch*:
    // duplicateOf() only sees what is already stored.
    this.fingerprint(d);
    this.indexUrl(d);
    this.save(d);
    return true;
  }
  update(id: string, patch: Partial<RawDispatch>) {
    this.items = this.items.map((x) => (x.id === id ? { ...x, ...patch } : x));
    const doc = this.items.find((x) => x.id === id);
    if (!doc) return;
    // dropped first, re-registered below if the document still has text.
    this.forget(id);
    this.fingerprint(doc);
    this.indexUrl(doc);
    this.save(doc, (fresh) => ({ ...fresh, ...patch }));
  }
  pending(limit: number) {
    return this.items
      .filter((d) => d.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
  }

  /**
   * Fingerprint a document and index it. Stubs are skipped on purpose: an `irrelevant` dispatch has
   * its text stripped (auto-ingest) and a `duplicate` row has no text at all, so indexing one would
   * let an exact match resolve to the stub instead of the canonical post behind it.
   */
  private fingerprint(d: RawDispatch): string | null {
    if (!d.text) return null;
    const fp = d.contentHash ?? simHash64(d.text);
    this.fingerprints.set(fp, d.id);
    this.fingerprintIds.set(d.id, fp);
    return fp;
  }

  /**
   * Index a document's canonical URL. Unlike the text fingerprint this keeps stubs: a `duplicate`
   * row has no text but does carry the URL of the article it points at, and re-indexing it is what
   * makes a third copy resolve to the canonical post rather than to a stub. `duplicateOfUrl`
   * therefore resolves through a stub to whatever the stub duplicates.
   */
  private indexUrl(d: RawDispatch): string | null {
    const key = canonicalUrl(d.url);
    if (!key) return null;
    this.urlKeys.set(key, d.id);
    this.urlKeyIds.set(d.id, key);
    return key;
  }

  private forget(id: string) {
    const key = this.urlKeyIds.get(id);
    if (key !== undefined) {
      this.urlKeyIds.delete(id);
      // Only drop the key if this document is still the one holding it, so two documents
      // sharing a URL cannot leave the index pointing at the one being forgotten.
      if (this.urlKeys.get(key) === id) this.urlKeys.delete(key);
    }
    const fp = this.fingerprintIds.get(id);
    if (fp === undefined) return;
    this.fingerprintIds.delete(id);
    this.fingerprints.delete(fp);
  }

  /**
   * Find the already-stored dispatch for this URL, ignoring the document's own id.
   *
   * `excludeId` is what makes this safe to call from `add`: the row being added is already in
   * `this.items`, so without it every dispatch would find itself.
   *
   * A document whose text has been stripped does not suppress. `irrelevant` is the case that
   * matters: the gate rejects on the text it was given, and one feed serving a teaser while
   * another serves the full body is the normal shape of an overlap. If the teaser copy is allowed
   * to suppress, the copy with the actual report in it is dropped and the article is never
   * analysed. The fingerprint path has always had this rule (see `fingerprint`), and URL identity
   * has to keep it.
   *
   * A `duplicate` stub is the exception: it has no text either, but it names the canonical post
   * that does, so resolution follows the link rather than stopping.
   */
  duplicateOfUrl(url: string | undefined | null, excludeId?: string): string | null {
    const key = canonicalUrl(url);
    if (!key) return null;
    const hit = this.urlKeys.get(key);
    if (hit === undefined || hit === excludeId) return null;
    const doc = this.items.find((d) => d.id === hit);
    if (!doc) return null;
    if (doc.status === "duplicate") {
      return doc.duplicateOf && doc.duplicateOf !== excludeId ? doc.duplicateOf : null;
    }
    return doc.text ? hit : null;
  }

  /**
   * Find the already-stored dispatch this fingerprint duplicates.
   *
   * Exact fingerprints win first (an identical repost or a channel forward), then the near match:
   * the newest dispatches first, because a duplicate almost always lands in the same or the next
   * sync. The scan is capped so a large archive cannot make collection O(n) per post forever.
   */
  duplicateOf(fingerprint: string): string | null {
    const exact = this.fingerprints.get(fingerprint);
    if (exact !== undefined) return exact;
    for (const d of this.items.slice(0, DUP_SCAN_WINDOW)) {
      if (!d.text) continue;
      const fp = this.fingerprint(d);
      if (fp && isNearDuplicate(fingerprint, fp)) return d.id;
    }
    return null;
  }

  override async attach(store: DocumentStore) {
    await super.attach(store);
    // attach() replaces the whole working set (claim() relies on that), so the index is rebuilt
    // lazily against the new one rather than trusted across the swap.
    this.fingerprints.clear();
    this.fingerprintIds.clear();
    this.urlKeys.clear();
    this.urlKeyIds.clear();
  }
  /**
   * Delegates the exclusive claim to storage. The lease deliberately lives in the store, not
   * in this cache: the cache is a per-tab snapshot and cannot make claiming exclusive.
   */
  async claim(limit: number, leaseMs: number, owner: string) {
    if (!this.store?.claim) return null;
    const ids = await this.store.claim("dispatches", { limit, leaseMs, owner });
    if (ids === null) return null;
    // Re-read so the claimed documents come back with the values just written by any other
    // worker, rather than from a cache that may predate their change.
    await this.attach(this.store);
    return ids;
  }
  async release(ids: string[], owner: string) {
    await this.store?.release?.("dispatches", ids, owner);
  }
}

export class LocalTaxonomyRepository
  extends CachedRepository<"taxonomies">
  implements TaxonomyRepository
{
  constructor() {
    super(
      "taxonomies",
      SEEDED_TERMS.map((t) => storedTerm(t)),
    );
  }

  /** Stored edits replace the seed with the same id. Seeds missing from the store stay available. */
  override async attach(store: DocumentStore) {
    // Same rule as the base repository: a failed load or seed leaves the old store in place.
    const loaded = await store.load(this.collection);
    if (loaded === null) {
      await store.seed(this.collection, this.items);
      this.store = store;
      this.revs = new Map(this.items.map((t) => [t.id, 0]));
      return;
    }
    const byId = new Map(this.items.map((t) => [t.id, t]));
    // Seed-only terms are deliberately absent from `revs`: they do not exist in the store
    // yet, so their first write must be an insert rather than a conditional update.
    const revs = new Map<string, number>();
    for (const entry of loaded) {
      byId.set(entry.doc.id, entry.doc);
      revs.set(entry.doc.id, entry.rev);
    }
    this.items = [...byId.values()];
    this.revs = revs;
    this.store = store;
    this.emit();
  }

  terms(taxonomy?: string) {
    return taxonomy ? this.items.filter((t) => t.taxonomy === taxonomy) : this.items;
  }

  upsertTerm(term: StoredTaxonomyTerm) {
    const i = this.items.findIndex((t) => t.id === term.id);
    this.items =
      i >= 0 ? this.items.map((t) => (t.id === term.id ? term : t)) : [...this.items, term];
    this.save(term);
  }
}

function candidateId(taxonomy: string, rawTerm: string) {
  const slug = rawTerm
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${taxonomy}/${slug || "term"}`;
}

export class LocalTaxonomyCandidateRepository
  extends CachedRepository<"taxonomy_candidates">
  implements TaxonomyCandidateRepository
{
  constructor() {
    super("taxonomy_candidates", []);
  }

  record(rawTerm: string, taxonomy: string, source: TaxonomySourceRef): TaxonomyCandidate {
    const id = candidateId(taxonomy, rawTerm);
    const now = new Date().toISOString();
    const sourceKey = source.sourceId ?? source.source;
    // Apply the observation to the freshest copy. If the source is already listed there the
    // observation is not counted twice, which is what makes this safe to replay after a conflict.
    const apply = (base: TaxonomyCandidate): TaxonomyCandidate => {
      if (base.sources.some((s) => (s.sourceId ?? s.source) === sourceKey)) return base;
      return {
        ...base,
        occurrences: base.occurrences + 1,
        lastSeen: now,
        sources: [...base.sources, { ...source, seenAt: now }],
      };
    };
    const existing = this.items.find((c) => c.id === id);
    if (existing) {
      const next = apply(existing);
      if (next === existing) return existing;
      this.items = this.items.map((c) => (c.id === id ? next : c));
      this.save(next, apply);
      return next;
    }
    const created: TaxonomyCandidate = {
      id,
      taxonomy,
      rawTerm: rawTerm.trim(),
      status: "candidate",
      occurrences: 1,
      firstSeen: now,
      lastSeen: now,
      sources: [{ ...source, seenAt: now }],
    };
    this.items = [created, ...this.items];
    this.save(created, apply);
    return created;
  }

  resolve(id: string, to: "mapped" | "promoted" | "rejected", target?: string) {
    const at = new Date().toISOString();
    const apply = (fresh: TaxonomyCandidate): TaxonomyCandidate => ({
      ...fresh,
      status: to,
      ...(target ? { resolvedCanonicalId: target } : {}),
      lastSeen: at,
    });
    this.items = this.items.map((c) => (c.id === id ? apply(c) : c));
    const doc = this.items.find((c) => c.id === id);
    if (doc) this.save(doc, apply);
  }

  /**
   * Revert a resolved candidate back to an unresolved one. The UI undo for reject/map cannot go
   * through resolve() because "candidate" is the absence of a decision, not one of its outcomes.
   */
  unresolve(id: string) {
    const apply = (fresh: TaxonomyCandidate): TaxonomyCandidate => {
      const next: TaxonomyCandidate = { ...fresh, status: "candidate" };
      delete next.resolvedCanonicalId;
      return next;
    };
    this.items = this.items.map((c) => (c.id === id ? apply(c) : c));
    const doc = this.items.find((c) => c.id === id);
    if (doc) this.save(doc, apply);
  }
}

export class LocalProcurementRepository extends CachedRepository<"procurements"> {
  constructor() {
    super("procurements", []);
  }
  /**
   * Idempotent by content: a post re-analysed after a heuristic or model change produces a new
   * document id, so `p.id` cannot prevent a duplicate row. The source claim and figure can.
   */
  add(p: Procurement) {
    const key = p.dedupeKey ?? procurementDedupeKey(p);
    if (
      this.items.some((existing) => (existing.dedupeKey ?? procurementDedupeKey(existing)) === key)
    )
      return;
    this.items = [p, ...this.items];
    this.save(p);
  }
}
