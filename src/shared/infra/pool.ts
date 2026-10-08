export interface PoolProgress<T> {
  /** Items settled so far, including the one that just finished. */
  done: number;
  total: number;
  item: T;
}

/** A settled outcome, so the caller sees successes and failures side by side, in input order. */
export type PoolResult<R> = PromiseSettledResult<R>;

/**
 * Runs `worker` over `items` with at most `limit` in flight.
 *
 * Used by source collection: ~79 hosts are polled per sync pass and they used to be fetched one
 * at a time, so the whole pass paid the sum of every latency. Collecting in parallel turns that
 * into a fraction of the slowest lane.
 *
 * Guarantees:
 * - every item is started exactly once, and `results` is filled in input order;
 * - a throwing worker never rejects the pool - its result comes back as `rejected`, and the
 *   remaining items still run, so one bad source cannot cost the other 78;
 * - `key` serialises items sharing a key. Several monitored sources point at one host (five
 *   GitHub release atoms, for instance): parallel requests to the same host hit its rate limit
 *   and look abusive, while other hosts still run concurrently.
 *
 * `onSettled` is fire-and-forget by design - a progress reporter must never gate the pool, and
 * a slow report must not slow collection.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  opts: { key?: (item: T) => string; onSettled?: (progress: PoolProgress<T>) => void } = {},
): Promise<PoolResult<R>[]> {
  const total = items.length;
  if (total === 0) return [];

  // A lane count under 1 would deadlock, and more lanes than items is just items.
  const lanes = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : total, total));
  const results: PoolResult<R>[] = new Array(total);

  return new Promise<PoolResult<R>[]>((resolve) => {
    const waiting = items.map((_, i) => i);
    const activeKeys = new Set<string>();
    let active = 0;
    let settled = 0;

    const pump = () => {
      while (active < lanes && waiting.length > 0) {
        const at = waiting.findIndex((i) => {
          const key = opts.key?.(items[i]!);
          return key === undefined || !activeKeys.has(key);
        });
        // Nothing eligible: every lane is busy and the remaining items share a busy key.
        if (at === -1) return;
        start(waiting.splice(at, 1)[0]!);
      }
      if (settled === total && waiting.length === 0) resolve(results);
    };

    const start = (index: number) => {
      const item = items[index]!;
      const key = opts.key?.(item);
      active++;
      if (key !== undefined) activeKeys.add(key);
      void worker(item, index).then(
        (value) => {
          results[index] = { status: "fulfilled", value };
        },
        (reason: unknown) => {
          results[index] = { status: "rejected", reason };
        },
      ).then(() => {
        active--;
        if (key !== undefined) activeKeys.delete(key);
        settled++;
        opts.onSettled?.({ done: settled, total, item });
        // A resolve here is redundant with the one in pump() for the last lane, but harmless.
        pump();
      });
    };

    pump();
  });
}
