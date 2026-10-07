import type { Collection, CollectionMap, DocumentStore } from "@/shared/contracts/store";

const KEYS: Record<Collection, string> = {
  drones: "dti.drones.v1",
  candidates: "dti.candidates.v1",
  sources: "dti.sources.v1",
  dispatches: "dti.dispatches.v1",
  procurements: "dti.procurements.v1",
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
      } catch {
        /* quota - the original is still in place below only if the write above failed */
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
    } catch {
      /* quota */
    }
  }
  async load<C extends Collection>(c: C) {
    return this.read(c);
  }
  async seed<C extends Collection>(c: C, items: CollectionMap[C][]) {
    this.write(c, items);
  }
  async put<C extends Collection>(c: C, doc: CollectionMap[C]) {
    const items = (this.read(c) ?? []) as { id: string }[];
    const i = items.findIndex((x) => x.id === doc.id);
    this.write(c, i >= 0 ? items.map((x) => (x.id === doc.id ? doc : x)) : [doc, ...items]);
  }
  async remove(c: Collection, id: string) {
    this.write(
      c,
      ((this.read(c) ?? []) as { id: string }[]).filter((x) => x.id !== id),
    );
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
