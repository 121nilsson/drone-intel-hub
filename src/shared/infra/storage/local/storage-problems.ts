/**
 * Storage failures the shell has to show. Kept apart from a repository's change subscription:
 * a storage problem must survive the cache reload that follows it, so it has its own listeners.
 */
export class StorageProblems {
  private fns = new Set<(message: string) => void>();

  subscribe(fn: (message: string) => void) {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  }

  report(message: string, cause?: unknown) {
    const detail =
      cause === undefined
        ? message
        : `${message} (${cause instanceof Error ? cause.message : String(cause)})`;
    console.error(`[store] ${detail}`, cause ?? "");
    this.fns.forEach((fn) => {
      try {
        fn(detail);
      } catch (e) {
        // A UI listener must not break persistence or another listener.
        console.error("[store] storage-error listener failed", e);
      }
    });
  }
}
