import type { ExtractedSpec, Extraction } from "@/entities/drone/types";
import { fold } from "@/entities/drone/verification-evidence";
import type { IntelExtractor, RequoteItem, RequoteReply } from "@/shared/contracts/ai";

/** Most figures one repair call asks for. The rest are dropped without a repair attempt. */
export const REQUOTE_MAX_ITEMS = 12;

export interface EvidenceBrakeResult {
  /** Specs removed because their quote is not in the post and no repair kept them. */
  dropped: number;
  /** Specs whose quote a repair call replaced with an exact passage from the post. */
  requoted: number;
}

/**
 * Autonomy brake: a model-produced figure is only actionable if its evidence actually appears in
 * the original post. Uses the verifier's `fold`, so both checks agree on what "in the post" means.
 *
 * A failing AI figure gets one repair attempt per post (see `requote`); a heuristic-only figure
 * is only counted. Identity fields are untouched. Mutates `extraction` in place, as the pipeline
 * always has, so the spec lists it keeps are the ones the caller sees.
 */
export async function applyEvidenceBrake(
  raw: string,
  extraction: Extraction,
  engine: string | undefined,
  requoter: IntelExtractor | undefined,
): Promise<EvidenceBrakeResult> {
  const folded = fold(raw);
  const groups: ExtractedSpec[][] = [
    ...(extraction.specs ? [extraction.specs] : []),
    ...(extraction.systemExtractions ?? []).map((s) => s.specs),
  ];
  // A spec can sit in both the primary list and a system list: each figure is judged once.
  const failing = new Set<ExtractedSpec>();
  for (const group of groups)
    for (const spec of group) if (!holdsIn(folded, spec)) failing.add(spec);
  if (failing.size === 0) return { dropped: 0, requoted: 0 };

  const aiExtraction = engine === "ai" || engine === "combined";
  const askable = [...failing].filter((spec) => aiExtraction && producedByAi(spec));
  const repairs = new Map<ExtractedSpec, ExtractedSpec>();
  if (requoter && askable.length > 0) {
    const batch = askable.slice(0, REQUOTE_MAX_ITEMS);
    const items: RequoteItem[] = batch.map((spec, i) => ({
      ref: String(i + 1),
      label: spec.label,
      value: `${spec.value}${spec.unit ? ` ${spec.unit}` : ""}`,
      quote: String(spec.evidence ?? spec.raw),
    }));
    const replies = await requestQuotes(requoter, raw, items);
    const byRef = new Map(replies.map((r) => [r.ref, r.quote]));
    batch.forEach((spec, i) => {
      const quote = byRef.get(String(i + 1));
      if (quote && quoteAccepted(folded, quote, spec))
        repairs.set(spec, { ...spec, evidence: quote });
    });
  }

  const keep = (group: ExtractedSpec[]): ExtractedSpec[] =>
    group.flatMap((spec) => {
      if (!failing.has(spec)) return [spec];
      const repaired = repairs.get(spec);
      return repaired ? [repaired] : [];
    });
  if (extraction.specs) extraction.specs = keep(extraction.specs);
  if (extraction.systemExtractions)
    extraction.systemExtractions = extraction.systemExtractions.map((s) => ({
      ...s,
      specs: keep(s.specs),
    }));
  return { dropped: failing.size - repairs.size, requoted: repairs.size };
}

/** A spec with no proof passes; otherwise its quote must occur in the post. */
function holdsIn(folded: string, spec: ExtractedSpec): boolean {
  const proof = spec.evidence ?? spec.raw;
  if (!proof) return true;
  return folded.includes(fold(String(proof)));
}

/** Heuristic-only figures are never sent to a model. Absent provenance on an AI pass counts as AI. */
function producedByAi(spec: ExtractedSpec): boolean {
  return spec.provenance === undefined || spec.provenance === "ai" || spec.provenance === "both";
}

/**
 * A repaired quote is kept only if it is non-empty, occurs in the post, and, when the figure has
 * digits, carries every digit run of the figure. Spaces and thousands commas are ignored on both
 * sides, so "2 000", "2,000" and "2000" agree; the runs are compared whole, so "25" does not
 * stand in for "2.5".
 */
function quoteAccepted(folded: string, quote: string, spec: ExtractedSpec): boolean {
  const q = fold(quote);
  if (!q || !folded.includes(q)) return false;
  const value = String(spec.value);
  if (!/\d/.test(value)) return true;
  const quoteRuns = new Set(squash(quote).match(/\d+/g) ?? []);
  return (squash(value).match(/\d+/g) ?? []).every((run) => quoteRuns.has(run));
}

const squash = (s: string) => fold(s).replace(/[\s,]/g, "");

/** A repair that fails for any reason is no repair: the figure is then dropped as before. */
async function requestQuotes(
  requoter: IntelExtractor,
  raw: string,
  items: RequoteItem[],
): Promise<{ ref: string; quote: string | null }[]> {
  if (!requoter.requote) return [];
  try {
    const replies: RequoteReply[] = await requoter.requote(raw, items);
    if (!Array.isArray(replies)) return [];
    return replies.flatMap((r) =>
      r && typeof r.ref === "string"
        ? [{ ref: r.ref, quote: typeof r.quote === "string" ? r.quote.trim() : null }]
        : [],
    );
  } catch {
    return [];
  }
}
