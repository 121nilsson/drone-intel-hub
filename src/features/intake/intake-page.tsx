import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useCandidates, useDrones, useServices } from "@/shared/infra/services";
import { translateText } from "@/shared/infra/ai-proxy.functions";
import { Btn, Panel, Tag } from "@/shared/ui/primitives";
import { mergeInto, promote, runTwoTier } from "./pipeline";
import type { Candidate } from "@/entities/drone/types";

function ExpandableText({ text, className = "" }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 200;
  return (
    <div>
      <p className={`${className} ${!expanded && isLong ? "line-clamp-3" : ""}`}>{text}</p>
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

function CandidateRow({ c }: { c: Candidate }) {
  const svc = useServices();
  const drones = useDrones();
  const translateFn = useServerFn(translateText);
  const e = c.extraction;
  const systems = e.systems ?? [];
  const [target, setTarget] = useState(e.matchId ?? "");
  const [name, setName] = useState(e.name ?? systems.find((s) => !s.matchId)?.name ?? "");
  const [translating, setTranslating] = useState(false);
  const [translated, setTranslated] = useState<string | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);

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

  return (
    <li className="border border-border bg-background/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={c.tier === 2 ? "accent" : "default"}>Tier {c.tier}</Tag>
        <Tag tone={e.confidence > 0.75 ? "primary" : e.confidence > 0.5 ? "accent" : "danger"}>conf {Math.round(e.confidence * 100)}%</Tag>
        {e.domain && <Tag>{e.domain}</Tag>}
        {c.resolvedBy === "auto" && <Tag tone="accent">auto</Tag>}
        <span className="ml-auto font-mono text-xs text-muted-foreground">{c.source}</span>
      </div>
      <h3 className="mt-2 text-lg font-semibold">{e.name ?? "Unnamed system"}</h3>
      {systems.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] uppercase text-muted-foreground">Detected:</span>
          {systems.map((s) => (
            <button key={s.name} type="button" disabled={c.status !== "pending"} onClick={() => { setName(s.name); if (s.matchId) setTarget(s.matchId); }}
              className="border border-border px-2 py-0.5 font-mono text-xs hover:border-primary">
              {s.name}{s.matchId ? ` = ${s.matchId}` : s.variantOf ? ` · new variant of ${s.variantOf}` : " · new"}
            </button>
          ))}
        </div>
      )}
      <ExpandableText text={c.raw} className="mt-2 text-sm" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Btn variant="ghost" onClick={handleTranslate} disabled={translating || !c.raw.trim()}>
          {translating ? "Translating…" : "Translate"}
        </Btn>
        {translateError && <span className="font-mono text-xs text-destructive">{translateError}</span>}
      </div>
      {translated && (
        <div className="mt-2 border-l-2 border-primary/30 pl-3">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">English translation</p>
          <p className="mt-1 text-sm">{translated}</p>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {e.specs.map((s, i) => <Tag key={i} tone="primary">{s.label}: {String(s.value)}{s.unit ? ` ${s.unit}` : ""}</Tag>)}
        {e.rfBands.map((b) => <Tag key={b}>{b}</Tag>)}
      </div>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{e.rationale}</p>
      {c.status === "pending" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={name} onChange={(ev) => setName(ev.target.value)} placeholder="System name"
            className="w-48 border border-border bg-card px-2 py-1.5 font-mono text-xs outline-none focus:border-primary" aria-label="Candidate name" />
          <Btn onClick={() => { promote(c, svc, name); svc.candidates.update(c.id, { resolvedBy: "analyst" }); }} disabled={!name.trim()}>Promote</Btn>
          <select value={target} onChange={(ev) => setTarget(ev.target.value)} className="border border-border bg-card px-2 py-1.5 font-mono text-xs" aria-label="Merge target">
            <option value="">-- Select system to merge into --</option>
            {drones.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <Btn variant="ghost" disabled={!target} onClick={() => { mergeInto(c, target, svc); svc.candidates.update(c.id, { resolvedBy: "analyst" }); }}>Merge</Btn>
          <Btn variant="danger" onClick={() => svc.candidates.update(c.id, { status: "discarded", resolvedBy: "analyst" })}>Discard</Btn>
        </div>
      ) : (
        <p className="mt-3 font-mono text-xs uppercase text-muted-foreground">
          {c.status}{c.resolvedInto && <> → <Link to="/systems/$id" params={{ id: c.resolvedInto }} className="text-primary">{c.resolvedInto}</Link></>}
        </p>
      )}
    </li>
  );
}

export function IntakePage({ draft, draftSource }: { draft?: string | undefined; draftSource?: string | undefined } = {}) {
  const svc = useServices();
  const candidates = useCandidates();
  const [raw, setRaw] = useState("");
  const [source, setSource] = useState("Analyst paste");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (draft) { setRaw(draft); if (draftSource) setSource(draftSource); } }, [draft, draftSource]);

  const submit = async () => {
    if (!raw.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const { escalationThreshold, autoMergeThreshold, autoPromoteThreshold, autoDiscardThreshold } = svc.settings;
      const r = await runTwoTier(raw, source, { ...svc, escalationThreshold, autoMergeThreshold, autoPromoteThreshold, autoDiscardThreshold });
      const conf = `Tier ${r.candidate.tier}, ${Math.round(r.candidate.extraction.confidence * 100)}%`;
      setMsg(
        r.kind === "auto-merged" ? `Auto-merged into ${r.droneId} (${conf}).`
          : r.kind === "auto-promoted" ? `Auto-promoted as new system ${r.droneId} (${conf}).`
            : r.kind === "auto-discarded" ? `Auto-discarded as low confidence (${conf}).`
              : `Queued for triage (${conf}).`,
      );
      setRaw("");
    } catch (e) { setMsg(`Extraction failed: ${(e as Error).message}`); }
    setBusy(false);
  };
  const pending = candidates.filter((c) => c.status === "pending");
  const resolved = candidates.filter((c) => c.status !== "pending");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Panel title="Quick-paste intake" right={<Tag>{svc.tier1.label} → {svc.tier2.label}</Tag>}>
        <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={9} placeholder="Paste a dispatch, link, or raw text…"
          className="w-full border border-border bg-background p-3 font-mono text-sm outline-none focus:border-primary" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={source} onChange={(e) => setSource(e.target.value)} className="flex-1 border border-border bg-background px-2 py-1.5 font-mono text-xs" placeholder="Source" />
          <Btn variant="ghost" onClick={() => setRaw(SAMPLE)}>Sample</Btn>
          <Btn onClick={submit} disabled={busy || !raw.trim()}>{busy ? "Analyzing…" : "Ingest"}</Btn>
        </div>
        {msg && <p className="mt-3 font-mono text-xs text-accent">{msg}</p>}
        <p className="mt-4 text-xs text-muted-foreground">Tier 1 screens and extracts. Below {Math.round(svc.settings.escalationThreshold * 100)}% confidence or without a catalog match, Tier 2 reasoning re-analyzes. Matches above {Math.round(svc.settings.autoMergeThreshold * 100)}% auto-merge; new, uniquely named systems above {Math.round(svc.settings.autoPromoteThreshold * 100)}% auto-promote; anything below {Math.round(svc.settings.autoDiscardThreshold * 100)}% is auto-discarded.</p>
      </Panel>
      <div className="space-y-6">
        <Panel title={`Triage queue · ${pending.length}`}>
          <ul className="space-y-3">{pending.map((c) => <CandidateRow key={c.id} c={c} />)}</ul>
          {!pending.length && <p className="text-sm text-muted-foreground">Queue clear.</p>}
        </Panel>
        {resolved.length > 0 && <Panel title="Resolved"><ul className="space-y-3">{resolved.slice(0, 10).map((c) => <CandidateRow key={c.id} c={c} />)}</ul></Panel>}
      </div>
    </div>
  );
}
