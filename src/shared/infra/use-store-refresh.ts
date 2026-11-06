import { useEffect } from "react";

/**
 * Keeps the catalogue a long-open tab shows close to the server's.
 *
 * Each repository holds a snapshot read at startup. Another tab, the sync that runs on the server,
 * and the verifier all change the stored documents, and until now only the Sources page re-read
 * anything: a tab left open showed an old catalogue, and an edit made on it then conflicted. This
 * re-reads the small collections when the tab regains focus or becomes visible, and now and then
 * while it is visible. Dispatches are left out on purpose: they are thousands of documents and the
 * Sources page reloads them itself.
 *
 * A repository with a write still on its way is skipped, and a snapshot that went stale while it
 * was being read is dropped (`reload`'s `apply`): putting the stored copy over an edit the store
 * has not seen would lose it.
 */
export interface Refreshable {
  /** True while a write or delete is queued or running. */
  readonly busy: boolean;
  reload(apply?: () => boolean): Promise<void>;
}

/** Re-read every repository that has no write in flight. A failed reload is reported, not thrown. */
export async function refreshRepos(
  repos: readonly Refreshable[],
  onError: (cause: unknown) => void = () => {},
): Promise<number> {
  let refreshed = 0;
  await Promise.all(
    repos.map(async (repo) => {
      if (repo.busy) return;
      try {
        await repo.reload(() => !repo.busy);
        refreshed++;
      } catch (e) {
        onError(e);
      }
    }),
  );
  return refreshed;
}

/** Do not refresh twice within this long, so focus, visibility and the timer do not stack up. */
export const MIN_REFRESH_GAP_MS = 15_000;
/** How often a visible tab refreshes by itself. */
export const REFRESH_INTERVAL_MS = 120_000;

export function useStoreRefresh(repos: readonly Refreshable[], enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let last = Date.now();
    let running = false;
    const run = async () => {
      if (running || document.visibilityState === "hidden") return;
      if (Date.now() - last < MIN_REFRESH_GAP_MS) return;
      running = true;
      try {
        await refreshRepos(repos, (e) => console.warn("[store] background refresh failed", e));
      } finally {
        last = Date.now();
        running = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(run, REFRESH_INTERVAL_MS);
    return () => {
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [repos, enabled]);
}
