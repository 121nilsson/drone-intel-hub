import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { translateText } from "@/shared/infra/ai-proxy.functions";
import { Btn } from "@/shared/ui/primitives";

/**
 * Translates a post into English on demand.
 *
 * A shared widget rather than a page component: the Feed and the dossier's provenance sheet
 * both offer it, and a component that lives in one page's module makes the other slice depend
 * on that page.
 */
export function TranslateButton({ text, model }: { text: string; model: string }) {
  const fn = useServerFn(translateText);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (out)
    return (
      <div className="mt-2 min-w-0 border-l-2 border-primary/30 pl-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          English translation
        </p>
        <p className="mt-0.5 break-words text-sm">{out}</p>
      </div>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Btn
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const r = await fn({ data: { text, model } });
            if (r.ok) setOut(r.translated);
            else setErr(r.error);
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Translation failed");
          }
          setBusy(false);
        }}
      >
        {busy ? "Translating…" : "Translate"}
      </Btn>
      {err && <span className="font-mono text-[11px] text-destructive">{err}</span>}
    </span>
  );
}
