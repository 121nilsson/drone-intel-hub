import { createHash } from "node:crypto";
import { claimFingerprintInput } from "@/entities/drone/claim-fingerprint";
import { ENTAILMENT_VERSION, textHash } from "@/entities/drone/entailment";
import { attributeSemantic } from "@/entities/drone/spec-engine";
import type {
  ClaimEntailment,
  Drone,
  SpecAttribute,
  SpecClaim,
  StoredEntailmentVerdict,
} from "@/entities/drone/types";
import { claimSourceUnit } from "@/entities/normalization/claim-source-unit";
import type { Sql } from "@/shared/infra/postgres/db.server";

/**
 * What the audit freezes when it draws a claim (migrations/026): which claim exactly, which post
 * text, and what the second reader had said about it. The audit then compares a person's answer
 * with the reader as it stood, not with whatever the catalogue says by the time someone looks.
 */

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The claim as an auditor and the reader saw it; changes when its figures, unit, quote or post do. */
export function claimFingerprint(
  drone: Drone,
  spec: SpecAttribute,
  claim: SpecClaim & { id: string },
  postText: string,
): string {
  // The unit is the one evidenced for this claim; the attribute's own unit is the canonical one
  // and says nothing about what this source wrote (claimSourceUnit).
  const unit = claimSourceUnit(claim, spec);
  return sha256(
    claimFingerprintInput({
      fingerprintVersion: 1,
      claimId: claim.id,
      droneId: drone.id,
      semantic: attributeSemantic(spec),
      rawValue: claim.value,
      // Only an evidenced unit: the extractor's unconfirmed one is a claim about the text, not in it.
      rawUnit: unit.basis === "value_text" || unit.basis === "quote" ? (unit.unit ?? null) : null,
      rawUnitBasis: unit.basis,
      quantityQualifier: claim.normalized?.range?.qualifier ?? null,
      evidenceHash: sha256(claim.evidence?.trim() || claim.raw?.trim() || ""),
      sourceTextHash: sha256(postText),
    }),
  );
}

/** The exact input a reader call was given, system and user prompt, with the post as it was cut. */
export const readerInputHash = (system: string, prompt: string): string =>
  sha256(`${system}\u0000${prompt}`);

export type ReaderStateAtDraw = "verified_snapshot" | "legacy_unverified" | "stale" | "none";

/**
 * What the reader had on a claim at the moment it is drawn. Only a reading made for this version
 * of the reader, this post text and this claim version is a snapshot of the claim as drawn; one
 * written without a fingerprint cannot be shown to be about it.
 */
export function readerStateAtDraw(
  claim: SpecClaim,
  postText: string,
  fingerprint: string,
): ReaderStateAtDraw {
  const e = claim.entailment;
  if (!e) return "none";
  if (!e.claimFingerprint) return "legacy_unverified";
  if (
    e.version === ENTAILMENT_VERSION &&
    e.textHash === textHash(postText) &&
    e.claimFingerprint === fingerprint
  )
    return "verified_snapshot";
  return "stale";
}

export type ReaderPhase = "at_draw" | "after_draw" | "backfill";

/** The row a reading becomes in verification_audit_reader. */
export function readerRow(
  auditId: string,
  e: ClaimEntailment,
  phase: ReaderPhase,
  context: { postText: string; fallbackFingerprint?: string; answeredAt?: Date | null },
) {
  const verdict: StoredEntailmentVerdict = e.verdict;
  const fingerprint = e.claimFingerprint ?? context.fallbackFingerprint ?? null;
  const evaluated = new Date(e.at);
  return {
    audit_id: auditId,
    phase,
    before_human_answer: context.answeredAt ? +evaluated <= +context.answeredAt : true,
    // A backfilled reading is not tied to a claim version: it keeps no fingerprint of its own.
    claim_fingerprint: phase === "backfill" ? null : fingerprint,
    source_text_hash: sha256(context.postText),
    reader_input_hash: phase === "backfill" ? null : (e.readerInputHash ?? null),
    truncated: e.truncated === true,
    provider: e.provider,
    model: e.model,
    independence: e.independence,
    prompt_version: e.version,
    entailment_version: e.version,
    verdict: verdict === "unsupported" ? "legacy_unsupported" : verdict,
    span: e.span ?? null,
    note: e.note ?? null,
    evaluated_at: evaluated,
  };
}

export type ReaderRow = ReturnType<typeof readerRow>;

/** Append readings; a duplicate at_draw for an audit item is refused by the unique index. */
export async function appendReaderRows(sql: Sql, rows: readonly ReaderRow[]): Promise<void> {
  if (!rows.length) return;
  await sql`insert into verification_audit_reader ${sql(rows as unknown as Record<string, unknown>[])}`;
}
