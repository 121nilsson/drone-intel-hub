import type { StoredEntailmentVerdict } from "./types";

/**
 * How a reader's verdict stands against a claim, with the legacy "unsupported" kept as its own
 * kind of opposition: it is not re-read as contradicted or not_found, because it was never decided
 * which one it was.
 */
export type ReaderStance = "supports" | "contradicts" | "absent" | "legacy_opposes" | "uncertain";

export function readerStance(
  verdict: StoredEntailmentVerdict | null | undefined,
): ReaderStance | null {
  switch (verdict) {
    case "supported":
      return "supports";
    case "contradicted":
      return "contradicts";
    case "not_found":
      return "absent";
    case "unsupported":
      return "legacy_opposes";
    case "uncertain":
      return "uncertain";
    default:
      return null;
  }
}

/** The reader says the post does not state the claim: contradicted, not found, or legacy. */
export function readerOpposes(verdict: StoredEntailmentVerdict | null | undefined): boolean {
  const stance = readerStance(verdict);
  return stance === "contradicts" || stance === "absent" || stance === "legacy_opposes";
}
