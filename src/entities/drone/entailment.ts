import type { ClaimEntailment, EntailmentVerdict, SpecClaim } from "./types";
import { fold } from "./verification";

/**
 * The second reader (get_human_out_of_the_loop_plan.md §4.3, step 5): a model that did not
 * extract the claim is asked whether the post states it.
 *
 * Pure. The prompt it builds withholds the extractor's quote and reasoning - shown them, a judge
 * agrees with them - and the reply it accepts must point at a passage the post really contains:
 * a reader that invents its evidence gets `uncertain`, not the verdict it asked for. In Phase 2
 * nothing acts on the verdict; it is measured against the human seed set first.
 */

/**
 * Bumping this asks the reader again about every claim it has answered. 2: claims numbered [n]
 * (a reader echoed "ref 1" and its answers were lost), and independence recorded per verdict.
 */
export const ENTAILMENT_VERSION = "entailment-2";

/** A short stable hash of a post's text (FNV-1a): a changed post is read again. */
export function textHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
}

/** Whether the reader has to be asked about this claim against this post. */
export const needsEntailment = (claim: SpecClaim, hash: string) =>
  claim.entailment?.version !== ENTAILMENT_VERSION || claim.entailment.textHash !== hash;

/** One claim as the reader sees it: no quote, no confidence, no rationale. */
export interface EntailmentQuestion {
  ref: string;
  system: string;
  /**
   * The other names the catalogue knows the system by (catalogNames): a Russian post that names
   * "Герань-2" names the entry called Shahed-136, and told only "Shahed-136" the reader would say
   * the figure belongs to another system.
   */
  aliases?: readonly string[];
  attribute: string;
  value: string;
}

/** What one answer becomes once checked against the post. */
export interface EntailmentAnswer {
  verdict: EntailmentVerdict;
  span?: string;
  note?: string;
}

/**
 * Posts are long; the reader sees the beginning, where the figures nearly always are. Past it the
 * reader cannot see, so on a cut post its "unsupported" is read as uncertain (readEntailmentReply).
 */
const MAX_POST_CHARS = 12000;
/** Names listed per system; the catalogue keeps many spellings, and the first few carry it. */
const MAX_ALIASES = 6;

export function entailmentPrompt(
  post: string,
  questions: readonly EntailmentQuestion[],
): { system: string; prompt: string; truncated: boolean } {
  const system = [
    "You check claims against a source text. You are not told how the claims were found.",
    "For each claim decide only whether the TEXT states this value for this attribute of this",
    "system - not whether it is true, and not whether it is plausible.",
    'Answer "supported" only if the text states it, and give the exact passage, copied',
    "character for character from the text, that states it.",
    'Answer "unsupported" if the text gives a different value, attributes it to another',
    "system, or does not state it.",
    'Answer "uncertain" if the text is ambiguous about it.',
    "A value in another unit or wording that means the same quantity is supported.",
    'Each claim is numbered [n]; answer with that number as "ref".',
    'Reply with JSON only: {"answers":[{"ref":"1","verdict":"supported|unsupported|uncertain","span":"..."}]}',
  ].join(" ");
  const claims = questions
    .map((q) => {
      const also = (q.aliases ?? []).filter((a) => a !== q.system).slice(0, MAX_ALIASES);
      const names = also.length ? ` (also called ${also.map((a) => `"${a}"`).join(", ")})` : "";
      return `[${q.ref}] system "${q.system}"${names}, attribute "${q.attribute}", value "${q.value}"`;
    })
    .join("\n");
  const truncated = post.length > MAX_POST_CHARS;
  const text = truncated ? `${post.slice(0, MAX_POST_CHARS)} […]` : post;
  return { system, prompt: `TEXT:\n${text}\n\nCLAIMS:\n${claims}`, truncated };
}

const VERDICTS: readonly EntailmentVerdict[] = ["supported", "unsupported", "uncertain"];

/**
 * Read the reply, one answer per asked ref. A claim the reply skips, a verdict it misspells, and a
 * "supported" whose passage is not in the post all become `uncertain`, with the reason noted, so
 * a careless reply can never raise a claim. On a post the reader saw only part of (`truncated`),
 * "unsupported" also becomes `uncertain`: the figure may be in the part it was not shown.
 */
export function readEntailmentReply(
  reply: unknown,
  refs: readonly string[],
  post: string,
  truncated = false,
): Map<string, EntailmentAnswer> {
  const answers = new Map<string, EntailmentAnswer>();
  const list =
    reply && typeof reply === "object" && Array.isArray((reply as { answers?: unknown }).answers)
      ? ((reply as { answers: unknown[] }).answers as unknown[])
      : [];
  const folded = fold(post);
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    // Refs are numbers; a reader that echoes "ref 1" or "[1]" still means 1. Only the first
    // number counts: joining every digit would read "1 of 13" as 113.
    const ref = /\d+/.exec(String(a["ref"] ?? ""))?.[0] ?? "";
    if (!refs.includes(ref) || answers.has(ref)) continue;
    const verdict = VERDICTS.find((v) => v === a["verdict"]);
    if (!verdict) {
      answers.set(ref, { verdict: "uncertain", note: "the reader gave no valid verdict" });
      continue;
    }
    const span = typeof a["span"] === "string" ? a["span"].trim().slice(0, 500) : "";
    const found = !!span && folded.includes(fold(span));
    if (verdict === "supported" && !found)
      answers.set(ref, {
        verdict: "uncertain",
        note: span
          ? "the passage the reader quoted is not in the post"
          : "the reader gave no passage",
      });
    else if (verdict === "unsupported" && truncated)
      answers.set(ref, {
        verdict: "uncertain",
        note: "the post was longer than the reader was shown",
      });
    else answers.set(ref, { verdict, ...(found ? { span } : {}) });
  }
  for (const ref of refs)
    if (!answers.has(ref))
      answers.set(ref, { verdict: "uncertain", note: "the reader skipped it" });
  return answers;
}

/** A provider and the model it would answer with. */
export interface ReaderOption {
  provider: string;
  model: string;
}

/**
 * The first reader, in the order given, whose model extracted none of the claims it is asked
 * about. A model checking its own reading is not a second reader; none at all is better.
 */
export function independentReader(
  options: readonly ReaderOption[],
  extractorModels: ReadonlySet<string>,
): ReaderOption | undefined {
  return options.find((o) => !extractorModels.has(o.model));
}

export function toEntailment(
  answer: EntailmentAnswer,
  reader: ReaderOption,
  hash: string,
  at: string,
  /** Whether the claim names the model that extracted it, so the reader is known to differ. */
  extractorKnown = true,
): ClaimEntailment {
  return {
    verdict: answer.verdict,
    independence: extractorKnown ? "checked" : "unknown",
    ...(answer.span ? { span: answer.span } : {}),
    ...(answer.note ? { note: answer.note } : {}),
    provider: reader.provider,
    model: reader.model,
    textHash: hash,
    version: ENTAILMENT_VERSION,
    at,
  };
}

/** How the reader's verdicts line up with a person's answers on the same claims. */
export interface EntailmentAgreement {
  /** Reader said supported: how often the person agreed the post states it. */
  supported: { yes: number; no: number };
  /** Reader said unsupported. */
  unsupported: { yes: number; no: number };
  /** Reader could not say. */
  uncertain: number;
}

export function entailmentAgreement(
  pairs: ReadonlyArray<{ human: "yes" | "no"; reader: EntailmentVerdict }>,
): EntailmentAgreement {
  const out: EntailmentAgreement = {
    supported: { yes: 0, no: 0 },
    unsupported: { yes: 0, no: 0 },
    uncertain: 0,
  };
  for (const { human, reader } of pairs) {
    if (reader === "uncertain") out.uncertain++;
    else out[reader][human]++;
  }
  return out;
}
