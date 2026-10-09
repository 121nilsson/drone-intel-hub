import type { Candidate, Drone } from "@/entities/drone/types";
import { SEED_DRONES } from "@/entities/drone/seed";
import { isNearDuplicate, simHash64 } from "@/entities/dispatch/simhash";
import { canonicalUrl } from "@/entities/dispatch/url-key";
import type { MonitoredSource } from "@/entities/source/types";
import { ACTIVE_SEED_SOURCES, SEED_SOURCES } from "@/entities/source/seed";
import type { RawDispatch } from "@/entities/dispatch/types";
import type { Procurement } from "@/entities/procurement/types";
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
import type { Collection, CollectionMap, DocumentStore } from "@/shared/contracts/store";

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
abstract class CachedRepository<C extends Collection> implements Subscribable {
  private fns = new Set<() => void>();
  protected store: DocumentStore | null = null;
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

  async attach(store: DocumentStore) {
    this.store = store;
    const loaded = await store.load(this.collection);
    if (loaded === null) await store.seed(this.collection, this.items);
    else {
      this.items = loaded;
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
    this.items = loaded;
    this.emit();
  }
  protected save(doc: CollectionMap[C]) {
    this.emit();
    this.store
      ?.put(this.collection, doc)
      .catch((e) => console.error(`[store] put ${this.collection}`, e));
  }
  protected drop(id: string) {
    this.emit();
    this.store
      ?.remove(this.collection, id)
      .catch((e) => console.error(`[store] remove ${this.collection}`, e));
  }
  list() {
    return this.items;
  }
}

export class LocalDroneRepository extends CachedRepository<"drones"> implements DroneRepository {
  constructor() {
    super("drones", SEED_DRONES);
  }
  get(id: string) {
    return this.items.find((d) => d.id === id);
  }
  upsert(drone: Drone) {
    const i = this.items.findIndex((d) => d.id === drone.id);
    this.items =
      i >= 0 ? this.items.map((d) => (d.id === drone.id ? drone : d)) : [...this.items, drone];
    this.save(drone);
  }
  remove(id: string) {
    this.items = this.items.filter((d) => d.id !== id);
    this.drop(id);
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
    if (doc) this.save(doc);
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
    if (doc) this.save(doc);
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
    this.save(doc);
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
    this.store = store;
    const loaded = await store.load(this.collection);
    if (loaded === null) {
      await store.seed(this.collection, this.items);
      return;
    }
    const byId = new Map(this.items.map((t) => [t.id, t]));
    for (const doc of loaded) byId.set(doc.id, doc);
    this.items = [...byId.values()];
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
    const existing = this.items.find((c) => c.id === id);
    if (existing) {
      if (existing.sources.some((s) => (s.sourceId ?? s.source) === sourceKey)) return existing;
      const next: TaxonomyCandidate = {
        ...existing,
        occurrences: existing.occurrences + 1,
        lastSeen: now,
        sources: [...existing.sources, { ...source, seenAt: now }],
      };
      this.items = this.items.map((c) => (c.id === id ? next : c));
      this.save(next);
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
    this.save(created);
    return created;
  }

  resolve(id: string, to: "mapped" | "promoted" | "rejected", target?: string) {
    this.items = this.items.map((c) =>
      c.id === id
        ? {
            ...c,
            status: to,
            ...(target ? { resolvedCanonicalId: target } : {}),
            lastSeen: new Date().toISOString(),
          }
        : c,
    );
    const doc = this.items.find((c) => c.id === id);
    if (doc) this.save(doc);
  }
}

export class LocalProcurementRepository extends CachedRepository<"procurements"> {
  constructor() {
    super("procurements", []);
  }
  add(p: Procurement) {
    this.items = [p, ...this.items];
    this.save(p);
  }
}
