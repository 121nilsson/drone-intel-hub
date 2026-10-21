import {
  DocumentConflictError,
  type Collection,
  type CollectionMap,
  type DocumentStore,
  type VersionedDoc,
} from "@/shared/contracts/store";

const KEYS: Record<Collection, string> = {
  drones: "dti.drones.v1",
  candidates: "dti.candidates.v1",
  sources: "dti.sources.v1",
  dispatches: "dti.dispatches.v1",
  procurements: "dti.procurements.v1",
  taxonomies: "dti.taxonomies.v1",
  taxonomy_candidates: "dti.taxonomy_candidates.v1",
};

const REV_KEYS: Record<Collection, string> = {
  drones: "dti.drones.rev.v1",
  candidates: "dti.candidates.rev.v1",
  sources: "dti.sources.rev.v1",
  dispatches: "dti.dispatches.rev.v1",
  procurements: "dti.procurements.rev.v1",
  taxonomies: "dti.taxonomies.rev.v1",
  taxonomy_candidates: "dti.taxonomy_candidates.rev.v1",
};

/** Browser-only store: one JSON array per collection in localStorage. */
export class LocalStorageStore implements DocumentStore {
  /**
   * `null` means "nothing stored yet" and is the only case that may trigger a reseed.
   * Unparseable content is a different thing entirely: treating it as absent silently
   * destroys the user's catalog on the next seed, so the bad value is backed up under a
   * `…corrupt` key first and reported, so it can be recovered by hand.
   */
  private read<C extends Collection>(c: C): CollectionMap[C][] | null {
    const raw = localStorage.getItem(KEYS[c]);
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
      return parsed as CollectionMap[C][];
    } catch (e) {
      const backupKey = `${KEYS[c]}.corrupt`;
      try {
        // Only move the original aside if no backup exists, so repeated failures cannot
        // overwrite a good earlier recovery point with a worse value.
        if (localStorage.getItem(backupKey) === null) localStorage.setItem(backupKey, raw);
      } catch (backupError) {
        // Returning null here would let attach() reseed and overwrite the only copy. Fail the
        // load instead: the shell shows the error and the raw value stays in place for recovery.
        throw new Error(
          `browser storage could not back up unreadable ${c} data (${
            backupError instanceof Error ? backupError.message : String(backupError)
          })`,
        );
      }
      console.error(
        `[local-store] ${KEYS[c]} is unreadable (${e instanceof Error ? e.message : e}); backed up to ${backupKey} and reseeded`,
      );
      // Returning null lets attach() reseed, so the app stays usable. That overwrites the
      // corrupt value, which is why the backup above is not optional.
      return null;
    }
  }
  private write(c: Collection, items: unknown[]) {
    try {
      localStorage.setItem(KEYS[c], JSON.stringify(items));
    } catch (e) {
      // A full (or blocked) localStorage used to make `put` resolve anyway. The repository then
      // updated its revision and the UI showed the edit as saved even though nothing was stored.
      // Fail loudly instead: the repository reports it and the shell shows the warning.
      throw new Error(
        `browser storage could not save ${c} (${e instanceof Error ? e.message : String(e)})`,
      );
    }
  }

  /**
   * Revisions live beside the documents, not inside them.
   *
   * The original collection value stays a plain JSON array, so data written before revisions
   * existed still loads (every document starts at revision 0). Losing the revision key is
   * therefore safe rather than corrupting the catalog.
   */
  private readRevs(c: Collection): Record<string, number> {
    const raw = localStorage.getItem(REV_KEYS[c]);
    if (raw === null) return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const revs: Record<string, number> = {};
      for (const [id, rev] of Object.entries(parsed)) {
        if (typeof rev === "number" && Number.isSafeInteger(rev) && rev >= 0) revs[id] = rev;
      }
      return revs;
    } catch {
      // The documents themselves are intact; treating every revision as 0 is the safe
      // interpretation: the next write is conditional on a document that may have moved, and
      // will simply be retried after a reload.
      return {};
    }
  }

  private writeRevs(c: Collection, revs: Record<string, number>) {
    try {
      localStorage.setItem(REV_KEYS[c], JSON.stringify(revs));
    } catch (e) {
      throw new Error(
        `browser storage could not save revisions for ${c} (${
          e instanceof Error ? e.message : String(e)
        })`,
      );
    }
  }

  async load<C extends Collection>(c: C): Promise<VersionedDoc<CollectionMap[C]>[] | null> {
    const items = this.read(c);
    if (items === null) return null;
    const revs = this.readRevs(c);
    return items.map((doc) => ({ doc, rev: revs[doc.id] ?? 0 }));
  }

  async seed<C extends Collection>(c: C, items: CollectionMap[C][]) {
    // Revision first: if the document write then fails, the stored revision is ahead of the
    // document. That is safe (a stale writer conflicts) whereas the reverse would let a later
    // write based on the old revision overwrite the document that did land.
    this.writeRevs(c, Object.fromEntries(items.map((doc) => [doc.id, 0])));
    this.write(c, items);
  }

  async put<C extends Collection>(
    c: C,
    doc: CollectionMap[C],
    expectedRev: number | null,
  ): Promise<number> {
    const items = (this.read(c) ?? []) as { id: string }[];
    const revs = this.readRevs(c);
    const i = items.findIndex((x) => x.id === doc.id);

    if (expectedRev === null) {
      if (i >= 0) throw new DocumentConflictError(c, doc.id);
      this.writeRevs(c, { ...revs, [doc.id]: 0 });
      this.write(c, [doc, ...items]);
      return 0;
    }

    if (i < 0 || (revs[doc.id] ?? 0) !== expectedRev) throw new DocumentConflictError(c, doc.id);

    const next = [...items];
    next[i] = doc;
    this.writeRevs(c, { ...revs, [doc.id]: expectedRev + 1 });
    this.write(c, next);
    return expectedRev + 1;
  }

  async remove(c: Collection, id: string) {
    this.write(
      c,
      ((this.read(c) ?? []) as { id: string }[]).filter((x) => x.id !== id),
    );
    const revs = this.readRevs(c);
    if (id in revs) {
      delete revs[id];
      this.writeRevs(c, revs);
    }
  }

  /**
   * Single-tab lease. localStorage has no compare-and-swap, so this cannot be made atomic
   * across tabs the way the PostgreSQL claim is - two tabs can still read the same pending
   * set. It is still worth having: the dominant case is one browser driving the queue while
   * the cron works against PostgreSQL, and the lease stops a single tab from double-processing
   * after a re-render or a double-click.
   *
   * The lease fields are stripped before writing so they never persist into the document.
   */
  async claim(
    c: Collection,
    opts: { limit: number; leaseMs: number; owner: string },
  ): Promise<string[] | null> {
    type Leased = { id: string; status?: string; leaseUntil?: number; leaseBy?: string };
    const items = (this.read(c) ?? []) as Leased[];
    const now = Date.now();
    const taken = items
      .filter((d) => d.status === "pending")
      .filter((d) => d.leaseUntil === undefined || d.leaseUntil < now || d.leaseBy === opts.owner)
      .slice(0, opts.limit);
    if (!taken.length) return [];
    const ids = new Set(taken.map((d) => d.id));
    const leased = new Map(taken.map((d) => [d.id, now + opts.leaseMs] as const));
    this.write(
      c,
      items.map((d) => {
        const { leaseUntil: _u, leaseBy: _o, ...rest } = d;
        return ids.has(d.id)
          ? { ...rest, leaseUntil: leased.get(d.id), leaseBy: opts.owner }
          : rest;
      }),
    );
    return [...ids];
  }

  async release(c: Collection, ids: string[], owner: string) {
    if (!ids.length) return;
    type Leased = { id: string; leaseUntil?: number; leaseBy?: string };
    const items = (this.read(c) ?? []) as Leased[];
    const set = new Set(ids);
    this.write(
      c,
      items.map((d) => {
        if (!set.has(d.id) || d.leaseBy !== owner) return d;
        const { leaseUntil: _u, leaseBy: _o, ...rest } = d;
        return rest;
      }),
    );
  }
}
