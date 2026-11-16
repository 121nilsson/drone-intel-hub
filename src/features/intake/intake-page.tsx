import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  useCandidates,
  useDispatches,
  useServices,
  useAttached,
} from "@/shared/infra/use-services";
import { fetchIntakeArticle, isBareUrl } from "@/shared/infra/sources/intake-fetch.functions";
import { Input, Textarea } from "@/shared/ui/fields";
import { Btn, Loading, Panel, Tag } from "@/shared/ui/primitives";
import { runTwoTier } from "@/shared/infra/ingest/pipeline";
import type { Candidate } from "@/entities/drone/types";
import { CandidateRow } from "./candidate-row";
import { groupUnresolvedFamilies, pageQueue } from "./intake-queue";
import { INTAKE_PAGE_SIZE } from "./intake-search";

const SAMPLE = `Telegram dispatch: Russia launched Geran-5 jet drones, one intercepted by a STING S interceptor. 4 jammers onboard and new 1575 MHz CRPA. Cruise 600 km/h, range 1000 km, 90 kg warhead. Unit cost $15,000-$20,000.`;

/**
 * The names a family group is titled by. Several candidates from one report are named by their
 * own names; a single multi-system candidate is named by the systems it contains, since its own
 * name is only one of them.
 */
function familyNames(family: readonly Candidate[]): string[] {
  const only = family.length === 1 ? family[0] : undefined;
  const systems = only?.extraction.systems ?? [];
  if (only && systems.length > 1) return systems.map((s) => s.name);
  return family.map((c) => c.extraction.name ?? "Unnamed system");
}

export function IntakePage({
  draft,
  draftSource,
  page = 1,
  onPageChange,
}: {
  draft?: string | undefined;
  draftSource?: string | undefined;
  /** The queue's page, from the URL; each page reveals one more block of pending candidates. */
  page?: number;
  onPageChange: (page: number) => void;
}) {
  const svc = useServices();
  const attached = useAttached();
  const candidates = useCandidates();
  const intakeFetch = useServerFn(fetchIntakeArticle);
  const [raw, setRaw] = useState("");
  const [source, setSource] = useState("Analyst paste");
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const visible = page * INTAKE_PAGE_SIZE;
  const [dragOver, setDragOver] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const dispatches = useDispatches();
  useEffect(() => {
    if (!busy || !startedAt) return;
    const id = setInterval(() => setNowTick(Date.now()), 500);
    return () => clearInterval(id);
  }, [busy, startedAt]);
  useEffect(() => {
    if (draft) {
      setRaw(draft);
      if (draftSource) setSource(draftSource);
    }
  }, [draft, draftSource]);

  const submit = async () => {
    if (!raw.trim()) return;
    setBusy(true);
    setStartedAt(Date.now());
    setMsg(null);
    try {
      const {
        escalationThreshold,
        autoMergeThreshold,
        autoPromoteThreshold,
        autoDiscardThreshold,
        heuristicFirst,
      } = svc.settings;
      let text = raw;
      if (isBareUrl(raw)) {
        setMsg("Fetching article from link…");
        const fetched = await intakeFetch({ data: { url: raw } });
        if (!fetched.ok) {
          setMsg(
            `Could not read the link: ${fetched.error}. Paste the article text directly instead.`,
          );
          setBusy(false);
          setStartedAt(null);
          return;
        }
        // Keep the URL in the record for provenance; the extractor sees it plus the article body.
        text = `${raw.trim()}\n\n${fetched.text}`;
      }
      const r = await runTwoTier(text, source, {
        ...svc,
        escalationThreshold,
        autoMergeThreshold,
        autoPromoteThreshold,
        autoDiscardThreshold,
        heuristicFirst,
        // Escalation is otherwise automatic: needsDeepAI only reaches tier 2 on low confidence,
        // unresolved multi-system attribution, or conflicting identity. An analyst pasting a
        // report by hand is the one case where the tier-2 budget is usually worth spending, so
        // this asks for it directly rather than leaving it to the gate. The tier-2 call runs
        // through the same provider chain as tier 1, so a busy provider falls back rather than
        // failing the paste.
        ...(deep ? { forceDeepAnalysis: true } : {}),
      });
      const conf = `Tier ${r.candidate.tier}, ${Math.round(r.candidate.extraction.confidence * 100)}%`;
      setMsg(
        r.kind === "auto-merged"
          ? `Auto-merged into ${r.droneId} (${conf}).`
          : r.kind === "auto-promoted"
            ? `Auto-promoted as new system ${r.droneId} (${conf}).`
            : r.kind === "auto-discarded"
              ? `Auto-discarded as low confidence (${conf}).`
              : `Queued for triage (${conf}).`,
      );
      setRaw("");
    } catch (e) {
      setMsg(`Extraction failed: ${(e as Error).message}`);
    }
    setBusy(false);
    setStartedAt(null);
  };
  // Memoised on the list itself: a fresh array every render would defeat every memo below, and
  // each keystroke in the paste box would regroup the whole queue.
  const pending = useMemo(() => candidates.filter((c) => c.status === "pending"), [candidates]);
  const resolved = useMemo(() => candidates.filter((c) => c.status !== "pending"), [candidates]);

  // Queue candidates that came from the same report are often the same base/variant family split
  // during multi-system extraction. Group them so an analyst can resolve one against the other.
  const unresolvedFamilies = useMemo(() => groupUnresolvedFamilies(pending), [pending]);
  const familyCandidateIds = useMemo(
    () => new Set(unresolvedFamilies.flat().map((c) => c.id)),
    [unresolvedFamilies],
  );
  const ungroupedPending = useMemo(
    () => pending.filter((c) => !familyCandidateIds.has(c.id)),
    [pending, familyCandidateIds],
  );

  // Families and single candidates share one page, so "Show 20 more" reveals at most 20 items.
  const queueItems = unresolvedFamilies.length + ungroupedPending.length;
  const shown = useMemo(
    () => pageQueue(unresolvedFamilies, ungroupedPending, visible),
    [unresolvedFamilies, ungroupedPending, visible],
  );

  // Repositories fill asynchronously after SSR; until they attach, "Queue clear" would be a lie.
  const detectedLang = /[Ѐ-ӿ]/.test(raw)
    ? /[A-Za-z]/.test(raw)
      ? "Mixed script"
      : "Cyrillic"
    : raw.trim()
      ? "Latin"
      : null;
  const bareUrl = isBareUrl(raw);
  const possibleDuplicate = useMemo(() => {
    const m = raw.match(/https?:\/\/\S+/);
    if (!m) return false;
    const url = m[0];
    return dispatches.some((d) => d.url === url || d.text.includes(url));
  }, [raw, dispatches]);

  if (!attached) return <Loading label="Loading queue…" />;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Panel
        title="Quick-paste intake"
        className="min-w-0"
        right={
          <Tag className="hidden max-w-full break-all sm:inline-flex">
            {svc.tier1.label} → {svc.tier2.label}
          </Tag>
        }
      >
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) {
              const reader = new FileReader();
              reader.onload = () => setRaw(String(reader.result ?? ""));
              reader.readAsText(file);
              return;
            }
            const text = e.dataTransfer.getData("text/plain");
            if (text) setRaw(text);
          }}
          className={`border ${dragOver ? "border-primary bg-primary/5" : "border-border"} bg-background`}
        >
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={9}
            placeholder="Paste a dispatch, link, or raw text… (or drop a file)"
            aria-label="Dispatch text"
            className="border-0 bg-transparent p-3 hover:border-0"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {detectedLang && <Tag tone="default">{detectedLang}</Tag>}
          {bareUrl && <Tag tone="accent">URL - article will be fetched on ingest</Tag>}
          {possibleDuplicate && <Tag tone="danger">Possible duplicate dispatch</Tag>}
          {dragOver && <Tag tone="primary">Drop to load</Tag>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-auto min-w-40 flex-1 text-xs"
            placeholder="Source"
            aria-label="Source"
          />
          <Btn variant="ghost" onClick={() => setRaw(SAMPLE)}>
            Sample
          </Btn>
          <Btn onClick={submit} disabled={busy || !raw.trim()}>
            {busy ? "Analyzing…" : deep ? "Ingest (tier 2)" : "Ingest"}
          </Btn>
        </div>
        {busy && startedAt && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Step: {deep ? "Heuristic → Tier 1 → Tier 2" : "Heuristic → Tier 1 (gates)"} ·{" "}
            {Math.max(1, Math.round((nowTick - startedAt) / 1000))}s elapsed
          </p>
        )}
        <label className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={deep}
            onChange={(e) => setDeep(e.target.checked)}
          />
          <span>
            Always run Tier 2 ({svc.tier2.label}). Off, Tier 2 is reached only when the gates below
            say the result is low-confidence or ambiguous. Tier 2 costs more and is slower, but on a
            hand-pasted report it is usually the difference between a merge and a triage queue item.
            Both tiers use the same provider fallback chain.
          </span>
        </label>
        {msg && <p className="mt-3 break-words font-mono text-xs text-accent">{msg}</p>}
        <p className="mt-4 break-words text-xs text-muted-foreground">
          Pasting a bare http(s) link fetches and reads the article server-side first. Local
          deterministic extraction runs first; Tier 1 fills unresolved fields and Tier 2 is reserved
          for low-confidence or ambiguous attribution below{" "}
          {Math.round(svc.settings.escalationThreshold * 100)}%, unless you tick the box above.{" "}
          Matches above {Math.round(svc.settings.autoMergeThreshold * 100)}% auto-merge; new,
          uniquely named systems above {Math.round(svc.settings.autoPromoteThreshold * 100)}%
          auto-promote; anything below {Math.round(svc.settings.autoDiscardThreshold * 100)}% is
          auto-discarded. If the AI provider is unreachable, ingestion falls back to the built-in
          heuristic engine and the candidate is marked degraded.
        </p>
      </Panel>
      <div className="min-w-0 space-y-6">
        <Panel title={`Triage queue · ${pending.length} candidates`}>
          {shown.families.length > 0 && (
            <div className="mb-4 space-y-3">
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                Unresolved variant families
              </p>
              {shown.families.map((family) => (
                <div
                  key={family.map((c) => c.id).join(":")}
                  className="border border-accent/40 bg-background/50 p-3"
                >
                  <p className="font-mono text-xs text-accent">
                    {familyNames(family).join(" / ")}
                    {family.some((c) => (c.extraction.systems ?? []).some((s) => s.variantOf))
                      ? " - resolve one as the base and one as its variant"
                      : " - choose whether one is a variant of the other"}
                  </p>
                  <ul className="mt-3 space-y-3">
                    {family.map((c) => (
                      <CandidateRow key={c.id} c={c} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <ul className="space-y-3">
            {shown.singles.map((c) => (
              <CandidateRow key={c.id} c={c} />
            ))}
          </ul>
          {!pending.length && <p className="text-sm text-muted-foreground">Queue clear.</p>}
          {/* One shared page across both lists, so a backlog of multi-system reports cannot push
              the rest of the queue out of reach or make "Show 20 more" reveal up to 40. */}
          {shown.hiddenRemaining > 0 && (
            <div className="mt-4 flex items-center gap-3">
              <Btn variant="ghost" onClick={() => onPageChange(page + 1)}>
                Show {Math.min(INTAKE_PAGE_SIZE, shown.hiddenRemaining)} more
              </Btn>
              <span className="font-mono text-xs text-muted-foreground">
                {shown.shownCount} of {queueItems} queue items · a family counts as one
              </span>
            </div>
          )}
        </Panel>
        {resolved.length > 0 && (
          <Panel title="Resolved">
            <ul className="space-y-3">
              {resolved.slice(0, 10).map((c) => (
                <CandidateRow key={c.id} c={c} />
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
