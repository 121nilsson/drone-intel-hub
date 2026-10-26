/**
 * The intel-feed header's honest totals. `archive` is the server's whole-archive answer; null
 * when no server storage answered (browser-only deployment, count endpoint unreachable), in
 * which case the loaded window is the best known truth - and the exact truth whenever the
 * archive fits the load cap.
 */
export interface ArchiveCounts {
  total: number;
  pending: number;
}

export function savedPostsLine(
  loaded: number,
  archive: ArchiveCounts | null,
  pendingLoaded: number,
): string {
  const n = (v: number) => v.toLocaleString("en-US");
  const saved =
    archive && archive.total > loaded
      ? `${n(loaded)} of ${n(archive.total)} saved posts`
      : `${n(loaded)} saved posts`;
  return `${saved} · ${n(archive ? archive.pending : pendingLoaded)} waiting for analysis`;
}
