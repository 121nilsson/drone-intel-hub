import { useMemo } from "react";

/**
 * The post with the quote marked, matched the way the verifier matched it (entities/drone/
 * verification.ts): NFKC-folded, across whitespace and case. A looser or stricter match would
 * leave some verified claims unmarked, and an unmarked claim would stand out from the rest.
 */
export function PostWithQuote({ text: raw, quote }: { text: string; quote?: string | undefined }) {
  const text = useMemo(() => raw.normalize("NFKC"), [raw]);
  const parts = useMemo(() => {
    const q = quote?.normalize("NFKC").trim();
    if (!q) return null;
    const pattern = q
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    const m = new RegExp(pattern, "iu").exec(text);
    return m
      ? { before: text.slice(0, m.index), hit: m[0], after: text.slice(m.index + m[0].length) }
      : null;
  }, [text, quote]);
  return (
    <p className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">
      {parts ? (
        <>
          {parts.before}
          <mark className="bg-primary/25 text-foreground">{parts.hit}</mark>
          {parts.after}
        </>
      ) : (
        text
      )}
    </p>
  );
}
