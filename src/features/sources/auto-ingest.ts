import type { MonitoredSource } from "@/entities/source/types";
import type { FetchedPost } from "@/shared/infra/source-fetch.functions";
import { runTwoTier, type PipelineDeps } from "@/features/intake/pipeline";

const DRONE_HINT = /drone|uav|ugv|usv|fpv|shahed|geran|lancet|bpla|бпла|дрон|квадрокоптер|ланцет|герань|interceptor|loitering|unmanned|jammer|РЭБ|EW\b/i;

export interface SyncReport { source: string; fetched: number; relevant: number; merged: number; queued: number; error?: string }

/** Fetch → dedupe → relevance filter → two-tier pipeline. Fetcher injected to keep the slice storage/transport agnostic. */
export async function syncSource(
  s: MonitoredSource,
  fetcher: (s: MonitoredSource) => Promise<{ ok: true; posts: FetchedPost[] } | { ok: false; error: string }>,
  deps: PipelineDeps,
  onSeen: (ids: string[]) => void,
): Promise<SyncReport> {
  const rep: SyncReport = { source: s.name, fetched: 0, relevant: 0, merged: 0, queued: 0 };
  const res = await fetcher(s);
  if (!res.ok) return { ...rep, error: res.error };
  const seen = new Set(s.seenIds ?? []);
  const fresh = res.posts.filter((p) => !seen.has(p.id));
  rep.fetched = fresh.length;
  for (const p of fresh) {
    if (!DRONE_HINT.test(p.text)) continue;
    rep.relevant++;
    const r = await runTwoTier(p.text, `${s.name} · ${p.url}`, deps);
    if (r.kind === "auto-merged") rep.merged++; else rep.queued++;
  }
  onSeen(fresh.map((p) => p.id));
  return rep;
}
