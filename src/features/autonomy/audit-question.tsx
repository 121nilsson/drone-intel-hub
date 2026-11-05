import { useEffect, useState } from "react";
import type { AuditAnswer, AuditItem } from "@/shared/contracts/verification";
import { Btn, EmptyNote } from "@/shared/ui/primitives";
import { SourceRef, SystemChip } from "@/shared/ui/links";
import { TranslateButton } from "@/shared/ui/translate-button";
import { AnswerGuide } from "./audit-answer-guide";
import { PostWithQuote } from "./audit-post-quote";

export function Question({
  item,
  onAnswer,
  busy,
}: {
  item: AuditItem;
  onAnswer: (
    answer: AuditAnswer,
    obviouslyWrong: boolean,
    readVia: "original" | "translation",
  ) => void;
  busy: boolean;
}) {
  const [obviouslyWrong, setObviouslyWrong] = useState(false);
  // Defaults to how a post in this language is likely read; the auditor corrects it.
  const [readVia, setReadVia] = useState<"original" | "translation">(
    item.language === "en" ? "original" : "translation",
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy || e.metaKey || e.ctrlKey || e.altKey) return;
      // Only typing suppresses the shortcuts: a ticked checkbox keeps focus, and the auditor's
      // next key is still an answer.
      const t = e.target;
      if (
        (t instanceof HTMLInputElement && t.type !== "checkbox") ||
        t instanceof HTMLTextAreaElement
      )
        return;
      const k = e.key.toLowerCase();
      if (k === "y") onAnswer("yes", obviouslyWrong, readVia);
      else if (k === "n") onAnswer("no", obviouslyWrong, readVia);
      else if (k === "c") onAnswer("cannot_tell", obviouslyWrong, readVia);
      else if (k === "w") setObviouslyWrong((v) => !v);
      else if (k === "t") setReadVia((v) => (v === "original" ? "translation" : "original"));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, obviouslyWrong, readVia, onAnswer]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Does the post state this value for this attribute of this system?
        </p>
        <p className="flex flex-wrap items-center gap-2 text-base">
          <SystemChip id={item.droneId} name={item.droneName} />
          <span className="text-muted-foreground">·</span>
          <span>{item.specLabel}</span>
          <span className="text-muted-foreground">=</span>
          <span className="font-mono font-semibold">{item.value}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          <SourceRef source={item.source} /> · {item.language} · {item.family}
        </p>
      </div>

      {item.postText ? (
        <div className="border border-border p-3">
          <PostWithQuote text={item.postText} quote={item.evidence} />
          {item.language !== "en" && (
            <div className="mt-2">
              <TranslateButton key={item.id} text={item.postText} />
            </div>
          )}
        </div>
      ) : (
        <EmptyNote>
          The post was not archived. Answer "can't tell" unless the quote alone settles it.
        </EmptyNote>
      )}
      {item.evidence && (
        <p className="text-xs text-muted-foreground">
          Quoted evidence: <span className="italic">“{item.evidence}”</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Btn disabled={busy} onClick={() => onAnswer("yes", obviouslyWrong, readVia)}>
          Yes <kbd className="ml-1 opacity-60">Y</kbd>
        </Btn>
        <Btn
          variant="danger"
          disabled={busy}
          onClick={() => onAnswer("no", obviouslyWrong, readVia)}
        >
          No <kbd className="ml-1 opacity-60">N</kbd>
        </Btn>
        <Btn
          variant="ghost"
          disabled={busy}
          onClick={() => onAnswer("cannot_tell", obviouslyWrong, readVia)}
        >
          Can't tell <kbd className="ml-1 opacity-60">C</kbd>
        </Btn>
        <label className="ml-2 inline-flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={obviouslyWrong}
            onChange={(e) => setObviouslyWrong(e.target.checked)}
          />
          The post says it, but it is plainly wrong <kbd className="opacity-60">W</kbd>
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={readVia === "translation"}
            onChange={(e) => setReadVia(e.target.checked ? "translation" : "original")}
          />
          Read through a translation <kbd className="opacity-60">T</kbd>
        </label>
      </div>
      <AnswerGuide />
    </div>
  );
}
