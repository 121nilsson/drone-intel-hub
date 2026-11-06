import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { translateText, generateSystemSummary } from "@/shared/infra/ai-proxy.functions";
import { buildSystemEvidenceDigest } from "@/shared/infra/system-evidence-digest";
import { useAttached, useServices } from "@/shared/infra/use-services";
import { detectLanguage } from "@/entities/normalization/language";
import { awaitingBrief, summaryView } from "./summary-view";
import { type Drone } from "@/entities/drone/types";
import { Collapsible } from "@/shared/ui/collapsible";
import { Prose } from "@/shared/ui/prose";
import { Btn } from "@/shared/ui/primitives";
import { SummaryText } from "@/shared/ui/summary-text";

/**
 * The structured AI dossier brief: the model's markdown overview plus the verified/caveat lists,
 * each labelled. Used both while a translation is still pending and as the steady-state brief,
 * so the two phases never disagree about the format.
 */
function SystemBrief({ brief }: { brief: NonNullable<Drone["llmBrief"]> }) {
  return (
    <Prose className="max-w-3xl">
      <SummaryText text={brief.overview} />
      {brief.verified.length ? (
        <section>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Verified facts
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {brief.verified.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {brief.caveats.length ? (
        <section>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Caveats and uncertainty
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {brief.caveats.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {brief.provenance.length ? (
        <section>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Sources and provenance
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {brief.provenance.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {brief.nextChecks.length ? (
        <section>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Suggested next checks
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {brief.nextChecks.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </Prose>
  );
}

/** Lines of a dossier's brief or summary shown before "Show more". */
const BRIEF_LINES = 10;

export function DossierSummary({
  drone,
  svc,
}: {
  drone: Drone;
  svc: ReturnType<typeof useServices>;
}) {
  const translateFn = useServerFn(translateText);
  // The repository is stable; `svc` itself changes whenever any setting does, and depending on it
  // here sent a new translation request for every change while the page was opening.
  const drones = svc.drones;
  const generateFn = useServerFn(generateSystemSummary);
  const generatedSummary = drone.llmSummary;
  const sourceSummary = drone.summary;
  const summary = generatedSummary ?? sourceSummary;
  const storageSummary = drone.summaryEnglish;
  // Text that is already English is not sent anywhere: a translator given English has no target.
  const likelyEnglish = Boolean(generatedSummary) || detectLanguage(sourceSummary) === "en";
  // Nothing below starts before the store has attached, because the server's AI configuration
  // arrives with it. Starting earlier meant acting on defaults and then again on the real values.
  const ready = useAttached();
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [briefGenerating, setBriefGenerating] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const briefAttempted = useRef<string | null>(null);
  const briefFingerprint = buildSystemEvidenceDigest(drone).fingerprint;
  const briefStale =
    !drone.llmSummaryGeneratedAt ||
    Date.now() - Date.parse(drone.llmSummaryGeneratedAt) > 7 * 24 * 60 * 60 * 1000;
  // A brief whose overview is a fenced or raw JSON blob is the earlier parser's failure, not a
  // brief; detecting it makes opening the card regenerate through the fixed parser at once.
  const briefIsBlob =
    !!drone.llmBrief &&
    !drone.llmBrief.verified.length &&
    /^\s*(```|\{|\[)/.test(drone.llmBrief.overview);
  const briefNeedsWork =
    !generatedSummary ||
    drone.llmSummaryFingerprint !== briefFingerprint ||
    briefStale ||
    briefIsBlob;
  const holdTranslation = awaitingBrief({
    ready,
    aiConfigured: svc.aiConfigured,
    briefNeedsWork,
    briefError,
    hasBrief: Boolean(drone.llmBrief),
  });

  useEffect(() => {
    // A generated brief is English and is the steady-state content; translating the scrape
    // summary around it would make the panel rewrite itself twice on open.
    if (drone.llmBrief) {
      setTranslated(null);
      setError(null);
      setTranslating(false);
      return;
    }
    if (storageSummary) {
      setTranslated(generatedSummary ? null : storageSummary);
      setError(null);
      setTranslating(false);
      return;
    }
    if (likelyEnglish || generatedSummary) {
      setTranslated(null);
      setError(null);
      setTranslating(false);
      return;
    }
    // The brief replaces this text, so translating it first only adds a step to the panel.
    if (holdTranslation) return;
    let cancelled = false;
    setTranslating(true);
    setError(null);
    void translateFn({ data: { text: sourceSummary } })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setTranslated(res.translated);
          try {
            drones.upsert({ ...drone, summaryEnglish: res.translated }, (fresh) => ({
              ...fresh,
              summaryEnglish: res.translated,
            }));
          } catch (err) {
            console.warn("[dossier] could not persist translated summary", err);
          }
        } else setError(res.error);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Translation failed");
      })
      .finally(() => {
        if (!cancelled) setTranslating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    drone,
    generatedSummary,
    likelyEnglish,
    sourceSummary,
    storageSummary,
    drones,
    holdTranslation,
    translateFn,
  ]);

  const runBriefGeneration = useCallback(
    async (force = false) => {
      if (!svc.aiConfigured) {
        setBriefError("Configure an AI model in settings to generate a system brief.");
        return;
      }
      if (!force && !briefNeedsWork) return;
      setBriefGenerating(true);
      setBriefError(null);
      try {
        const result = await generateFn({ data: { drone } });
        if (!result.ok) {
          setBriefError(result.error);
          return;
        }
        const generatedAt = new Date().toISOString();
        const brief = {
          llmSummary: result.summary,
          llmBrief: result.brief,
          llmSummaryGeneratedAt: generatedAt,
          llmSummaryFingerprint: briefFingerprint,
        };
        svc.drones.upsert({ ...drone, ...brief }, (fresh) => ({ ...fresh, ...brief }));
      } catch (err) {
        setBriefError(err instanceof Error ? err.message : "AI brief failed");
      } finally {
        setBriefGenerating(false);
      }
    },
    [briefNeedsWork, briefFingerprint, drone, svc, generateFn],
  );

  useEffect(() => {
    if (!ready || !svc.aiConfigured) return;
    if (!briefNeedsWork) return;
    const generationKey = `${drone.id}:${briefFingerprint}:${drone.llmSummaryGeneratedAt ?? "never"}`;
    if (briefAttempted.current === generationKey) return;
    briefAttempted.current = generationKey;
    void runBriefGeneration(false);
  }, [
    briefFingerprint,
    briefNeedsWork,
    drone.id,
    drone.llmSummaryGeneratedAt,
    ready,
    svc.aiConfigured,
    runBriefGeneration,
  ]);

  const view = summaryView({
    hasBrief: Boolean(drone.llmBrief),
    ready,
    aiConfigured: svc.aiConfigured,
    briefNeedsWork,
    briefError,
    translated,
    translating,
  });

  if (view === "translated") {
    return (
      <div className="space-y-2">
        <Collapsible lines={BRIEF_LINES} className="max-w-3xl text-base leading-relaxed">
          <p className="[overflow-wrap:anywhere]">{translated}</p>
        </Collapsible>
        <details className="font-mono text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Original ({likelyEnglish ? "English" : "source language"})
          </summary>
          <p className="mt-1 max-w-3xl leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {summary}
          </p>
        </details>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {view === "translating" && (
        <p className="max-w-3xl animate-pulse font-mono text-sm text-muted-foreground">
          Translating summary...
        </p>
      )}
      <Collapsible lines={BRIEF_LINES} className="text-sm leading-relaxed">
        {drone.llmBrief ? <SystemBrief brief={drone.llmBrief} /> : <SummaryText text={summary} />}
      </Collapsible>
      {(view === "generating" || briefGenerating) && (
        <p className="animate-pulse font-mono text-xs text-muted-foreground">
          Generating intelligence summary...
        </p>
      )}
      {view !== "generating" && !briefGenerating && ready && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Btn variant="ghost" onClick={() => void runBriefGeneration(true)}>
            {generatedSummary ? "Regenerate AI brief" : "Generate AI brief"}
          </Btn>
        </div>
      )}
      {briefError && <p className="font-mono text-xs text-destructive">{briefError}</p>}
    </div>
  );
}
