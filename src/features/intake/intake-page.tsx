import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useCandidates, useDispatches, useDrones, useServices } from "@/shared/infra/services";
import { translateText } from "@/shared/infra/ai-proxy.functions";
import { fetchIntakeArticle, isBareUrl } from "@/shared/infra/sources/intake-fetch.functions";
import { Btn, Loading, Panel, Tag } from "@/shared/ui/primitives";
import { mergeInto, promote, runTwoTier, recordMention } from "./pipeline";
import type { Candidate } from "@/entities/drone/types";

function ExpandableText({ text, className = "" }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 200;
  return (
    <div className="min-w-0">
      <p className={`break-words ${className} ${!expanded && isLong ? "line-clamp-3" : ""}`}>
        {text}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 font-mono text-[11px] text-muted-foreground hover:text-primary"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

const SAMPLE = `Telegram dispatch: Russia launched Geran-5 jet drones, one intercepted by a STING S interceptor. 4 jammers onboard and new 1575 MHz CRPA. Cruise 600 km/h, range 1000 km, 90 kg warhead. Unit cost $15,000-$20,000.`;

const PAGE = 20;

function CandidateRow({ c }: { c: Candidate }) {
  const svc = useServices();
  const drones = useDrones();
  const translateFn = useServerFn(translateText);
  const e = c.extraction;
  const systems = e.systems ?? [];
  const resolvedExists = !!c.resolvedInto && drones.some((x) => x.id === c.resolvedInto);
  const [target, setTarget] = useState(e.matchId ?? "");
  const [name, setName] = useState(e.name ?? systems.find((s) => !s.matchId)?.name ?? "");
  const [translating, setTranslating] = useState(false);
  const [translated, setTranslated] = useState<string | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [deepAnalyzing, setDeepAnalyzing] = useState(false);

  const handleTranslate = async () => {
    setTranslating(true);
    setTranslateError(null);
    try {
      const res = await translateFn({ data: { text: c.raw, model: svc.settings.translateModel } });
      if (res.ok) {
        setTranslated(res.translated);
      } else {
        setTranslateError(res.error);
      }
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : "Translation failed");
    }
    setTranslating(false);
  };

  const handleDeepAnalysis = async () => {
    setDeepAnalyzing(true);
    setTranslateError(null);
    try {
      const result = await runTwoTier(c.raw, c.source, {
        ...svc,
        escalationThreshold: svc.settings.escalationThreshold,
        autoMergeThreshold: svc.settings.autoMergeThreshold,
        autoPromoteThreshold: svc.settings.autoPromoteThreshold,
        autoDiscardThreshold: svc.settings.autoDiscardThreshold,
        heuristicFirst: svc.settings.heuristicFirst,
        forceDeepAnalysis: true,
      });
      svc.candidates.update(c.id, {
        status: "discarded",
        resolvedBy: "analyst",
        supersededBy: result.candidate.id,
      });
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : "Deep analysis failed");
    } finally {
      setDeepAnalyzing(false);
    }
  };

  return (
    <li className="min-w-0 break-words border border-border bg-background/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={c.tier === 2 ? "accent" : "default"}>Tier {c.tier}</Tag>
        <Tag tone={e.confidence > 0.75 ? "primary" : e.confidence > 0.5 ? "accent" : "danger"}>
          conf {Math.round(e.confidence * 100)}%
        </Tag>
        {e.domain && <Tag>{e.domain}</Tag>}
        {c.resolvedBy === "auto" && <Tag tone="accent">auto</Tag>}
        {/\bdeep model:\s*not/i.test(c.extraction.rationale) && (
          <Tag tone="danger">deep model questioned identity</Tag>
        )}
        {!c.extraction.specs.length && <Tag tone="accent">mention-only</Tag>}
        {(c.quality?.risks.includes("multi-system-attribution") ||
          (c.extraction.systems ?? []).some((s) => !s.matchId && s.variantOf)) && (
          <Tag tone="danger">unresolved base/variant</Tag>
        )}
        <span className="ml-auto max-w-full break-all font-mono text-xs text-muted-foreground">
          {c.source}
        </span>
      </div>
      <h3 className="mt-2 break-words text-lg font-semibold">{e.name ?? "Unnamed system"}</h3>
      {systems.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] uppercase text-muted-foreground">Detected:</span>
          {systems.map((s) => (
            <button
              key={s.name}
              type="button"
              disabled={c.status !== "pending"}
              onClick={() => {
                setName(s.name);
                if (s.matchId) setTarget(s.matchId);
              }}
              className="max-w-full break-words border border-border px-2 py-0.5 font-mono text-xs hover:border-primary"
            >
              {s.name}
              {s.matchId
                ? ` = ${s.matchId}`
                : s.variantOf
                  ? ` · new variant of ${s.variantOf}`
                  : " · new"}
            </button>
          ))}
        </div>
      )}
      <ExpandableText text={c.raw} className="mt-2 text-sm" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Btn variant="ghost" onClick={handleTranslate} disabled={translating || !c.raw.trim()}>
          {translating ? "Translating…" : "Translate"}
        </Btn>
        {c.status === "pending" && (
          <Btn
            variant="ghost"
            onClick={handleDeepAnalysis}
            disabled={deepAnalyzing || !c.raw.trim()}
          >
            {deepAnalyzing ? "Deep analyzing…" : "Deep analyze"}
          </Btn>
        )}
        {translateError && (
          <span className="font-mono text-xs text-destructive">{translateError}</span>
        )}
      </div>
      {translated && (
        <div className="mt-2 min-w-0 border-l-2 border-primary/30 pl-3">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            English translation
          </p>
          <p className="mt-1 break-words text-sm">{translated}</p>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {e.specs.map((s, i) => (
          <Tag key={i} tone="primary">
            {s.label}: {String(s.value)}
            {s.unit ? ` ${s.unit}` : ""}
          </Tag>
        ))}
        {e.rfBands.map((b) => (
          <Tag key={b}>{b}</Tag>
        ))}
      </div>
      {e.systemExtractions && e.systemExtractions.length > 0 && (
        <div className="mt-3 space-y-2 border-l-2 border-accent/30 pl-3">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Per-system attribution
          </p>
          {e.systemExtractions.map((system) => (
            <div key={`${system.matchId ?? system.name}`} className="text-xs">
              <p className="font-semibold">
                {system.name} · {Math.round(system.confidence * 100)}%
                {system.variantOf ? ` · variant of ${system.variantOf}` : ""}
              </p>
              <p className="text-muted-foreground">
                {system.specs
                  .map((s) => `${s.label}: ${String(s.value)}${s.unit ? ` ${s.unit}` : ""}`)
                  .join(" · ") || "Identity only; facts need review"}
              </p>
            </div>
          ))}
        </div>
      )}
      {e.metadata?.escalationReasons?.length ? (
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          Escalated: {e.metadata.escalationReasons.join(", ")}
          {e.metadata.model ? ` · ${e.metadata.model}` : ""}
        </p>
      ) : null}
      {c.quality && (
        <div className="mt-2 space-y-1 font-mono text-[11px] text-muted-foreground">
          <p>
            Candidate quality: conf {Math.round(c.quality.confidence * 100)}%, specs{" "}
            {c.quality.evidenceSpecCount}/{c.quality.specCount} with evidence
            {c.quality.systemNames.length ? " - " + c.quality.systemNames.join(", ") : ""}
          </p>
          {c.quality.risks.length > 0 && (
            <ul className="list-inside list-disc">
              {c.quality.risks.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="mt-2 break-words font-mono text-xs text-muted-foreground">{e.rationale}</p>
      {c.status === "pending" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            placeholder="System name"
            className="w-full min-w-0 max-w-full border border-border bg-card px-2 py-2 font-mono text-xs focus:border-primary sm:w-48"
            aria-label="Candidate name"
          />
          <Btn
            className="px-4 py-2"
            onClick={() => {
              promote(c, svc, name);
              svc.candidates.update(c.id, { resolvedBy: "analyst" });
              toast("Candidate promoted", {
                description: `New system “${name}” added to the catalog`,
              });
            }}
            disabled={!name.trim()}
          >
            Promote
          </Btn>
          <select
            value={target}
            onChange={(ev) => setTarget(ev.target.value)}
            className="max-w-full flex-1 border border-border bg-card px-2 py-2 font-mono text-xs sm:flex-none"
            aria-label="Merge target"
          >
            <option value="">-- Select system to merge into --</option>
            {drones.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <Btn
            variant="ghost"
            disabled={!target}
            onClick={() => {
              mergeInto(c, target, svc);
              svc.candidates.update(c.id, { resolvedBy: "analyst" });
              const targetName = drones.find((d) => d.id === target)?.name ?? target;
              toast("Merged into existing system", {
                description: targetName,
              });
            }}
          >
            Merge
          </Btn>
          <Btn
            variant="ghost"
            disabled={!target}
            onClick={() => {
              recordMention(c, target, svc);
            }}
          >
            Record mention
          </Btn>
          <Btn
            variant="danger"
            onClick={() => {
              // Snapshot the fields triage decisions touch so Undo can restore the exact
              // pre-discard state; optional fields are omitted rather than written as undefined.
              const prev: Partial<Candidate> = {
                status: c.status,
                ...(c.resolvedBy !== undefined ? { resolvedBy: c.resolvedBy } : {}),
                ...(c.resolvedInto !== undefined ? { resolvedInto: c.resolvedInto } : {}),
                ...(c.supersededBy !== undefined ? { supersededBy: c.supersededBy } : {}),
              };
              svc.candidates.update(c.id, { status: "discarded", resolvedBy: "analyst" });
              toast("Candidate discarded", {
                description: e.name ?? c.source,
                action: {
                  label: "Undo",
                  onClick: () => svc.candidates.update(c.id, prev),
                },
              });
            }}
          >
            Discard
          </Btn>
        </div>
      ) : (
        <p className="mt-3 font-mono text-xs uppercase text-muted-foreground">
          {c.status}
          {c.resolvedInto && (
            <>
              {" "}
              →{" "}
              {resolvedExists ? (
                <Link to="/systems/$id" params={{ id: c.resolvedInto }} className="text-primary">
                  {c.resolvedInto}
                </Link>
              ) : (
                // The entry was deleted from its dossier; keep the history, drop the dead link.
                <span className="line-through">{c.resolvedInto} (deleted)</span>
              )}
            </>
          )}
        </p>
      )}
    </li>
  );
}

export function IntakePage({
  draft,
  draftSource,
}: { draft?: string | undefined; draftSource?: string | undefined } = {}) {
  const svc = useServices();
  const candidates = useCandidates();
  const intakeFetch = useServerFn(fetchIntakeArticle);
  const [raw, setRaw] = useState("");
  const [source, setSource] = useState("Analyst paste");
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);
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
  const pending = candidates.filter((c) => c.status === "pending");
  const resolved = candidates.filter((c) => c.status !== "pending");

  // Queue candidates that came from the same raw report are often the same base/variant family
  // split during multi-system extraction. Group them together so an analyst can resolve one
  // against the other instead of seeing them as unrelated queue items.
  const unresolvedFamilies = useMemo(() => {
    const families = new Map<string, Candidate[]>();
    for (const c of pending) {
      const hasUnresolvedRelation = (c.extraction.systems ?? []).some(
        (s) => !s.matchId && Boolean(s.variantOf),
      );
      const isMultiSystem = (c.extraction.systems?.length ?? 0) > 1;
      if (!hasUnresolvedRelation && !isMultiSystem) continue;
      const key = c.raw.trim().slice(0, 240).toLowerCase();
      const group = families.get(key) ?? [];
      group.push(c);
      families.set(key, group);
    }
    return [...families.values()].filter((g) => g.length > 0);
  }, [pending]);

  const familyCandidateIds = useMemo(
    () => new Set(unresolvedFamilies.flat().map((c) => c.id)),
    [unresolvedFamilies],
  );
  const ungroupedPending = useMemo(
    () => pending.filter((c) => !familyCandidateIds.has(c.id)),
    [pending, familyCandidateIds],
  );

  // Repositories fill asynchronously after SSR; until they attach, "Queue clear" would be a lie.
  const detectedLang = /[\u0400-\u04ff]/.test(raw)
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

  if (!svc.attached) return <Loading label="Loading queue…" />;

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
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={9}
            placeholder="Paste a dispatch, link, or raw text… (or drop a file)"
            className="w-full bg-transparent p-3 font-mono text-sm focus:outline-none"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {detectedLang && <Tag tone="default">{detectedLang}</Tag>}
          {bareUrl && <Tag tone="accent">URL - article will be fetched on ingest</Tag>}
          {possibleDuplicate && <Tag tone="danger">Possible duplicate dispatch</Tag>}
          {dragOver && <Tag tone="primary">Drop to load</Tag>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="min-w-40 flex-1 border border-border bg-background px-2 py-2 font-mono text-xs"
            placeholder="Source"
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
        <Panel title={`Triage queue · ${pending.length}`}>
          {unresolvedFamilies.length > 0 && (
            <div className="mb-4 space-y-3">
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                Unresolved variant families
              </p>
              {unresolvedFamilies.map((family) => (
                <div
                  key={family.map((c) => c.id).join(":")}
                  className="border border-accent/40 bg-background/50 p-3"
                >
                  <p className="font-mono text-xs text-accent">
                    {family.map((c) => c.extraction.name ?? "Unnamed system").join(" / ")}
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
            {ungroupedPending.slice(0, visible).map((c) => (
              <CandidateRow key={c.id} c={c} />
            ))}
          </ul>
          {!pending.length && <p className="text-sm text-muted-foreground">Queue clear.</p>}
          {ungroupedPending.length > visible && (
            <div className="mt-4 flex items-center gap-3">
              <Btn variant="ghost" onClick={() => setVisible((v) => v + PAGE)}>
                Show {Math.min(PAGE, ungroupedPending.length - visible)} more
              </Btn>
              <span className="font-mono text-xs text-muted-foreground">
                {visible} of {ungroupedPending.length}
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
