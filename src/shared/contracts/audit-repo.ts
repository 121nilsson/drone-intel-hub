import type { AuditLanguage, ControlKind } from "@/entities/drone/audit";
import type { FormalDesign } from "@/entities/drone/audit-design";
import type { ClaimEntailment, Drone, StoredEntailmentVerdict } from "@/entities/drone/types";
import type { AuditAnswer, AuditSecondLook } from "@/shared/contracts/verification";

/**
 * Storage for the audit of `verified` claims and its frozen seed set (migrations/019, 021, 025,
 * 026, 027). Split into roles so a caller depends only on the operations it uses; the adapters
 * (shared/infra/postgres, shared/infra/null-repos) compose them into AuditRepo.
 *
 * Operations are domain operations. No SQL client crosses this port: what must happen in one
 * transaction is a unit of work (AuditDrawTx) the adapter opens, not a connection the caller holds.
 * The audit stays measured, never counted: none of these roles feeds a learning loop.
 */

/** A row of verification_audit, as the audit reads it. */
export interface AuditRow {
  id: string;
  batch_id: string;
  position: number;
  role: "audit" | "control" | "negative";
  in_seed: boolean;
  drone_id: string;
  drone_name: string;
  spec_label: string;
  claim_id: string;
  language: string;
  family: string;
  value: string;
  evidence: string | null;
  source: string;
  source_id: string | null;
  /** Selected only for the claim on screen; the status read would otherwise carry every post. */
  post_text?: string | null;
  answer: AuditAnswer | null;
  /**
   * The second reader's verdict as it stood when this claim was drawn (the at_draw snapshot of
   * verification_audit_reader). Never the catalogue's current reading.
   */
  reader?: StoredEntailmentVerdict | null;
  /** Whether that reader is known to differ from the claim's extractor. */
  reader_independence?: "checked" | "unknown" | null;
  /** Readings made after the draw, shown apart and never counted as the one at draw. */
  reader_after_draw?: ReaderReading[];
  /** A reading from before readings were tied to a claim version; shown, not counted at draw. */
  reader_legacy?: StoredEntailmentVerdict | null;
  obviously_wrong: boolean;
  read_via: "original" | "translation" | null;
  drawn_at: Date;
  control_kind?: ControlKind | null;
  control_disputed_at?: Date | null;
  /** The design this row was drawn under and the claim it stands for (formal draws). */
  audit_batch_id?: string | null;
  sampling_purpose?: "formal_eval" | "diagnostic" | "legacy" | null;
  sample_unit_id?: string | null;
  /** The sample unit's stratum, from audit_sample_units. */
  unit_stratum?: string | null;
}

export interface ReaderReading {
  verdict: StoredEntailmentVerdict;
  evaluated_at: Date | string;
  before_human_answer: boolean | null;
}

/** An audit row with what the disagreement list adds: the post it was drawn with, the second look. */
export type DisagreementRow = AuditRow & {
  post_text: string | null;
  second_look: AuditSecondLook | null;
  control_kind: "altered" | "misread" | null;
};

/** An audit row of a formal design, with the sample unit it stands for. */
export type RetryRow = AuditRow & { sample_unit_id: string | null };

/** The most recent formal design, with the rows its status is computed from. */
export interface DesignRow {
  id: string;
  sampling_design: FormalDesign;
}

/** One stored reading of the second reader on an audit item (verification_audit_reader). */
export interface ReaderRecord {
  audit_id: string;
  phase: "at_draw" | "after_draw" | "backfill";
  verdict: StoredEntailmentVerdict | "legacy_unsupported";
  independence: "checked" | "unknown" | null;
  evaluated_at: Date;
  before_human_answer: boolean | null;
  span: string | null;
  note: string | null;
}

/** What the reader had on a claim at the moment it was drawn. */
export type ReaderStateAtDraw = "verified_snapshot" | "legacy_unverified" | "stale" | "none";

/** The row a reading becomes in verification_audit_reader. */
export interface ReaderRow {
  audit_id: string;
  phase: "at_draw" | "after_draw" | "backfill";
  before_human_answer: boolean;
  claim_fingerprint: string | null;
  source_text_hash: string;
  reader_input_hash: string | null;
  truncated: boolean;
  provider: ClaimEntailment["provider"];
  model: ClaimEntailment["model"];
  independence: ClaimEntailment["independence"];
  prompt_version: ClaimEntailment["version"];
  entailment_version: ClaimEntailment["version"];
  verdict: Exclude<StoredEntailmentVerdict, "unsupported"> | "legacy_unsupported";
  span: string | null;
  note: string | null;
  evaluated_at: Date;
}

/** A row to freeze in verification_audit when a claim is drawn (migrations/019, 026, 027). */
export interface AuditInsertRow {
  batch_id: string;
  position: number;
  draw_seed: number;
  role: "audit" | "control" | "negative";
  in_seed: boolean;
  drone_id: string;
  drone_name: string;
  spec_key: string;
  spec_label: string;
  claim_id: string;
  language: AuditLanguage;
  family: string;
  state_at_draw: "verified" | "uncertain" | "rejected";
  verifier_version: string | null;
  value: string;
  control_kind: ControlKind | null;
  evidence: string | null;
  source: string;
  source_id: string | null;
  post_text: string | null;
  audit_batch_id: string;
  sampling_purpose: "formal_eval" | "diagnostic";
  sample_unit_id: string | null;
  claim_fingerprint: string;
  source_text_hash: string;
  reader_state_at_draw: ReaderStateAtDraw;
}

/** A sample unit of a formal design (audit_sample_units). */
export interface SampleUnitInsert {
  audit_batch_id: string;
  claim_id: string;
  stratum: string;
  inclusion_probability: number;
}

/** What a diagnostic draw records about itself in audit_batches. */
export interface DiagnosticDesignInsert {
  purpose: "formal_eval" | "diagnostic";
  samplingDesign: Record<string, unknown>;
  populationSize: number;
  sampleSize: number;
  seed: number;
}

/** What a formal draw records about itself in audit_batches. */
export interface FormalDesignInsert {
  samplingDesign: Record<string, unknown>;
  populationSize: number;
  sampleSize: number;
  seed: number;
}

/** What the draw reads from the catalogue: every drone, and the text of the posts claims cite. */
export interface AuditDrawPool {
  allDrones(): Promise<Drone[]>;
  claimPostTexts(ids: readonly string[]): Promise<{ id: string; text: string | null }[]>;
}

/** Reads of the audit that the status and the draw share; the draw reads them inside its lock. */
export interface AuditFrameReads {
  /** Every claim that was ever drawn into the audit, controls included. */
  auditedClaimIds(): Promise<string[]>;
  /** The most recent formal design, if any. */
  latestFormalDesign(): Promise<DesignRow | undefined>;
  /** The rows drawn under one formal design, with their sample units' strata. */
  formalDesignRows(designId: string): Promise<AuditRow[]>;
}

/**
 * The unit of work of a draw, run under one lock in one transaction: two tabs or a double click
 * must not both see "no seed set yet" and freeze two, or both draw the same claims.
 */
export interface AuditDrawTx extends AuditFrameReads {
  /** How many rows of the frozen seed set exist. */
  seedSetSize(): Promise<number>;
  /** The rows of a formal design as the voided-sample-unit check reads them. */
  retryCandidates(designId: string): Promise<RetryRow[]>;
  /** Record a diagnostic draw's own audit_batches row; returns its id. */
  insertDiagnosticDesign(design: DiagnosticDesignInsert): Promise<string>;
  /** Record a formal design's audit_batches row; returns its id. */
  insertFormalDesign(design: FormalDesignInsert): Promise<string>;
  /** The sample units of a formal design; returns each with its stored id. */
  insertSampleUnits(
    units: readonly SampleUnitInsert[],
  ): Promise<{ id: string; claim_id: string }[]>;
  /** Freeze the drawn rows; returns the stored id of each, by position. */
  insertAuditRows(rows: readonly AuditInsertRow[]): Promise<{ id: string; position: number }[]>;
  /** Append readings (never an update). */
  appendReaderRows(rows: readonly ReaderRow[]): Promise<void>;
  /** Ask again about sample units: copy each presentation as a new row of a retry batch. */
  insertRetryRows(retry: { batchId: string; seed: number; ids: readonly string[] }): Promise<void>;
}

/** Drawing claims into the audit. */
export interface AuditDraw extends AuditDrawPool {
  /** Run `draw` under the draw lock, in one transaction. */
  drawTransaction<T>(draw: (tx: AuditDrawTx) => Promise<T>): Promise<T>;
}

/** Recording the person's answers; each returns false when the row it names does not qualify. */
export interface AuditAnswers {
  recordAnswer(input: {
    id: string;
    answer: AuditAnswer;
    obviouslyWrong: boolean;
    readVia: "original" | "translation";
  }): Promise<boolean>;
  /** `disputedAt` null withdraws a dispute. */
  recordDispute(input: { id: string; disputedAt: Date | null }): Promise<boolean>;
  recordSecondLook(input: { id: string; look: AuditSecondLook | null }): Promise<boolean>;
}

/** Reading the audit's state back. */
export interface AuditReports extends AuditFrameReads {
  /** Every audit row with its stratum, or null when this backend has no audit storage. */
  statusRows(): Promise<AuditRow[] | null>;
  /** The stored readings of these audit items, oldest first. */
  readerRecords(auditIds: readonly string[]): Promise<ReaderRecord[]>;
  /** The post text frozen on one audit item. */
  postTextOf(auditId: string): Promise<string | null>;
  /** Verified claims with a post that were never drawn. */
  countUndrawn(): Promise<number>;
  /** The answered rows (controls included), with the post and second look each carries. */
  answeredRows(): Promise<DisagreementRow[]>;
  /** The audit items of these sample units, to find a unit's first presentation. */
  unitSiblings(units: readonly string[]): Promise<{ id: string; sample_unit_id: string }[]>;
}

/** What the second reader needs of the audit to measure itself. */
export interface AuditReaderHistory {
  /** Claims drawn into the audit as something a person answers, controls left out. */
  auditedClaimIdsExceptControls(): Promise<string[]>;
  /** The audit items of these claims that were frozen with a claim fingerprint. */
  fingerprintedItems(
    claimIds: readonly string[],
  ): Promise<
    { id: string; claim_id: string; claim_fingerprint: string | null; answered_at: Date | null }[]
  >;
  /** Append readings; a duplicate at_draw for an audit item is refused by a unique index. */
  appendReaderRows(rows: readonly ReaderRow[]): Promise<void>;
}

/** The one-off backfill of readings for items drawn before they were frozen (migration 026). */
export interface AuditLegacyBackfill {
  /** Items drawn before readings were frozen that have no history row. */
  legacyItemsWithoutHistory(): Promise<
    {
      id: string;
      claim_id: string;
      drone_id: string;
      post_text: string | null;
      answered_at: Date | null;
    }[]
  >;
  /** The readings the catalogue currently carries, for the claims of these drones. */
  currentReadings(
    droneIds: readonly string[],
  ): Promise<{ id: string; entailment: ClaimEntailment }[]>;
  /** Say on these items, once, where it is unset, that the draw recorded no reader state. */
  markReaderStateLegacy(auditIds: readonly string[]): Promise<void>;
}

export type AuditRepo = AuditDraw &
  AuditAnswers &
  AuditReports &
  AuditReaderHistory &
  AuditLegacyBackfill;
