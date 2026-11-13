/**
 * The identity of one claim as an auditor and the second reader saw it: a reading or an answer is
 * only about that claim if the fingerprint still matches. Pure; the sha256 over the canonical text
 * is taken in `*.server.ts` (node:crypto), so this module stays free of I/O and the browser bundle.
 */

/**
 * JSON with sorted keys and no insignificant whitespace (RFC 8785, JCS). The numbers a claim holds
 * are finite doubles, which JavaScript already serialises the way JCS requires; undefined members
 * are dropped as JSON.stringify drops them, and `null` is kept.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("canonicalJsonStringify: a non-finite number has no canonical form");
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value))
    return `[${value.map((v) => (v === undefined ? "null" : canonicalJsonStringify(v))).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJsonStringify(v)}`).join(",")}}`;
}

/** What identifies a claim: the figures and words it stands on, not when it was last touched. */
export interface ClaimIdentity {
  /**
   * Version of what this identity contains. A change to the members below is a new version, so two
   * code paths can never produce different fingerprints for the same claim without it showing.
   */
  fingerprintVersion: 1;
  claimId: string;
  droneId: string;
  semantic: string;
  /** The stored figure exactly as extracted (`SpecClaim.value`). */
  rawValue: number | string;
  /** The unit evidenced for this claim (claimSourceUnit), never the attribute's own unit. */
  rawUnit: string | null;
  rawUnitBasis: string | null;
  quantityQualifier: string | null;
  /** Hash of the quote the claim carries, "" when it has none. */
  evidenceHash: string;
  /** Hash of the post text the reader and the auditor were shown. */
  sourceTextHash: string;
}

/** The canonical text a claim fingerprint is the sha256 of. */
export const claimFingerprintInput = (identity: ClaimIdentity): string =>
  canonicalJsonStringify(identity);
