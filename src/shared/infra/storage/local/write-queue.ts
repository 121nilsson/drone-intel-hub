/**
 * Per-document write chains for one repository. Two writes to the same document must run in order:
 * the second has to use the revision the first returned, or it would conflict with its own
 * predecessor.
 *
 * Saves and deletes share one chain per id on purpose: a save queued before a delete still has to
 * update the existing document, and a save queued after it must insert (see CachedRepository.drop).
 * `inflight` spans every id so flush() waits for the whole repository, not one document.
 */
export class WriteQueue {
  private chains = new Map<string, Promise<void>>();
  private inflight = new Set<Promise<void>>();

  /**
   * Queue `task` behind the previous write to `id`. A failure is handed to `onFailure`, which
   * owns the reporting, so the chain itself never rejects and later writes still run.
   */
  enqueue(
    id: string,
    task: () => Promise<void>,
    onFailure: (cause: unknown) => void | Promise<void>,
  ): void {
    const previous = this.chains.get(id) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(task)
      .catch(onFailure);
    this.chains.set(id, next);
    this.inflight.add(next);
    void next.finally(() => {
      if (this.chains.get(id) === next) this.chains.delete(id);
      this.inflight.delete(next);
    });
  }

  /** Wait until every queued write and delete has settled. */
  async flush() {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }
}
