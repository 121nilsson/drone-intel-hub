import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useServices } from "@/shared/infra/use-services";
import { translateText } from "@/shared/infra/ai-proxy.functions";
import { Btn, ChipButton, Tag } from "@/shared/ui/primitives";
import { runTwoTier } from "@/shared/infra/ingest/pipeline";
import type { Candidate } from "@/entities/drone/types";
import { ExpandableText } from "./expandable-text";
import { CandidateDecision } from "./candidate-decision";

export function CandidateRow({ c }: { c: Candidate }) {
  const svc = useServices();
  const translateFn = useServerFn(translateText);
  const e = c.extraction;
  const systems = e.systems ?? [];
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
      const res = await translateFn({ data: { text: c.raw } });
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
            <ChipButton
              key={s.name}
              disabled={c.status !== "pending"}
              title="Use this name, and its catalog match as the merge target"
              onClick={() => {
                setName(s.name);
                if (s.matchId) setTarget(s.matchId);
              }}
            >
              {s.name}
              {s.matchId
                ? ` = ${s.matchId}`
                : s.variantOf
                  ? ` · new variant of ${s.variantOf}`
                  : " · new"}
            </ChipButton>
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
      <p className="mt-2 break-words text-sm text-foreground/80">{e.rationale}</p>
      {(() => {
        // The escalation gates and the quality risks name mostly the same problems; one list,
        // folded, keeps the card about the system rather than about the pipeline.
        const reasons = [
          ...new Set([...(e.metadata?.escalationReasons ?? []), ...(c.quality?.risks ?? [])]),
        ];
        if (!reasons.length && !c.quality) return null;
        return (
          <details className="mt-2 font-mono text-2xs text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">
              Why it needs review{reasons.length ? ` (${reasons.length})` : ""}
            </summary>
            <div className="mt-1.5 space-y-1.5 border-l-2 border-border pl-3">
              {reasons.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {reasons.map((r) => (
                    <Tag key={r} caps={false}>
                      {r}
                    </Tag>
                  ))}
                </div>
              )}
              {c.quality && (
                <p>
                  Confidence {Math.round(c.quality.confidence * 100)}% ·{" "}
                  {c.quality.evidenceSpecCount}/{c.quality.specCount} specs with evidence
                  {c.quality.systemNames.length ? ` · ${c.quality.systemNames.join(", ")}` : ""}
                </p>
              )}
              {e.metadata?.model && <p>Model: {e.metadata.model}</p>}
            </div>
          </details>
        );
      })()}
      <CandidateDecision
        c={c}
        name={name}
        setName={setName}
        target={target}
        setTarget={setTarget}
      />
    </li>
  );
}
