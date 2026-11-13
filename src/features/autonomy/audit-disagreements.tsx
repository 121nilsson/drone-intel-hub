import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  fetchAuditDisagreements,
  recordSecondLook,
} from "@/shared/infra/verification/verification.functions";
import type { AuditDisagreement, AuditSecondLook } from "@/shared/contracts/verification";
import { SystemChip } from "@/shared/ui/links";
import { Btn, EmptyNote, Panel, Tag } from "@/shared/ui/primitives";
import { PostWithQuote } from "./audit-post-quote";

/**
 * The answers the second reader contradicted. Each is a place where the person or the reader is
 * wrong, and which one is worth knowing: a pattern in the person's misses is a rule the answer
 * guide lacks, and a pattern in the reader's is a prompt to fix. The first answer is never
 * replaced - the audit counts it - so the second look is only recorded beside it.
 */

const LOOK_LABEL: Record<AuditSecondLook, string> = {
  stands: "My answer stands",
  reader_right: "The reader was right",
};

function Case({
  d,
  busy,
  onLook,
}: {
  d: AuditDisagreement;
  busy: boolean;
  onLook: (id: string, look: AuditSecondLook | null) => void;
}) {
  return (
    <li className="space-y-2 py-3">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <SystemChip id={d.droneId} name={d.droneName} />
        <span className="text-muted-foreground">·</span>
        <span>{d.specLabel}</span>
        <span className="text-muted-foreground">=</span>
        <span className="font-mono font-semibold [overflow-wrap:anywhere]">{d.value}</span>
      </p>
      <p className="flex flex-wrap items-center gap-2">
        <Tag tone={d.answer === "yes" ? "primary" : "danger"}>You: {d.answer}</Tag>
        <Tag tone="accent">
          Reader at draw: {d.reader === "unsupported" ? "unsupported (legacy)" : d.reader}
        </Tag>
      </p>
      {d.readerAfterDraw?.map((r) => (
        <p key={r.evaluatedAt} className="text-xs text-muted-foreground">
          Later reading ({new Date(r.evaluatedAt).toLocaleString()}): {r.verdict}
          {r.beforeHumanAnswer ? ", before you answered" : ", after you answered"}. Not the reading
          at draw.
        </p>
      ))}
      {d.evidence && (
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          Quoted evidence: <span className="italic">“{d.evidence}”</span>
        </p>
      )}
      {(d.readerSpan || d.readerNote) && (
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          The reader: {d.readerSpan && <span className="italic">“{d.readerSpan}”</span>}
          {d.readerSpan && d.readerNote && " · "}
          {d.readerNote}
        </p>
      )}
      {d.postText && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Read the post
          </summary>
          <div className="mt-2 border border-border p-3">
            <PostWithQuote text={d.postText} quote={d.evidence} />
          </div>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(LOOK_LABEL) as AuditSecondLook[]).map((look) => (
          <Btn
            key={look}
            size="sm"
            variant={d.secondLook === look ? "primary" : "ghost"}
            disabled={busy}
            aria-pressed={d.secondLook === look}
            onClick={() => onLook(d.id, d.secondLook === look ? null : look)}
          >
            {LOOK_LABEL[look]}
          </Btn>
        ))}
      </div>
    </li>
  );
}

export function AuditDisagreements() {
  const [cases, setCases] = useState<AuditDisagreement[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCases(await fetchAuditDisagreements());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setCases([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const look = async (id: string, value: AuditSecondLook | null) => {
    setBusy(true);
    try {
      await recordSecondLook({ data: { id, look: value } });
      setCases((prev) =>
        prev
          ? prev.map((c) => {
              if (c.id !== id) return c;
              const { secondLook: _old, ...rest } = c;
              void _old;
              return value ? { ...rest, secondLook: value } : rest;
            })
          : prev,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (cases === null) return null;
  const looked = cases.filter((c) => c.secondLook);
  const readerRight = looked.filter((c) => c.secondLook === "reader_right").length;
  return (
    <Panel
      title="Where you and the reader disagree"
      right={
        <Tag tone="muted" mono>
          {looked.length} / {cases.length} looked at again
        </Tag>
      }
    >
      {cases.length === 0 ? (
        <EmptyNote>The reader has contradicted none of your answers.</EmptyNote>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            You said yes where it said contradicted or not found, or no where it said supported.
            This is the reading it had when the claim was drawn; a later one is shown beside it with
            its time. Read the post again and say who was right. Your first answer is what the audit
            counts; this is a note beside it.
            {looked.length > 0 &&
              ` So far the reader was right in ${readerRight} of ${looked.length}.`}
          </p>
          <ul className="divide-y divide-border">
            {cases.map((c) => (
              <Case key={c.id} d={c} busy={busy} onLook={(id, v) => void look(id, v)} />
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
