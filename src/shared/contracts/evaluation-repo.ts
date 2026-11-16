import type { ControlledRow } from "@/entities/drone/audit";

/**
 * Persistence ports of the evaluation slot (docs/architecture.md). Each role is what one caller
 * needs and nothing more; `EvaluationRepo` is their composition, so a fake in a test implements
 * only the roles the code under test uses. The domain modules in shared/infra/evaluation own the
 * decisions (scoring, sampling, who may approve what); an adapter owns the statements.
 *
 * Fixtures and reports cross the port as plain JSON values (`unknown` / records): their shape is
 * the evaluation module's, and storage does not need to know it.
 */

/** The single-writer lock around a corpus or report job. A failed claim throws. */
export interface EvaluationLock {
  /** Takes the named lock for `ttlMs` unless another holder's has not expired. True when taken. */
  tryClaim(name: string, ttlMs: number): Promise<boolean>;
  release(name: string): Promise<void>;
}

/** The corpus version a run is pinned to, and its bump when a harvest adds fixtures. */
export interface CorpusVersions {
  /** The highest recorded version, 0 when nothing is harvested yet. */
  pinnedVersion(): Promise<number>;
  recordVersion(version: number, note: string): Promise<void>;
}

/** Importing the git-tracked corpus files as approved fixtures. */
export interface GitCorpusStore {
  gitFixtureExists(id: string): Promise<boolean>;
  insertGitFixture(row: {
    id: string;
    kind: "positive" | "negative";
    fixture: unknown;
  }): Promise<void>;
}

/** Writing fixtures harvested from agreement. */
export interface HarvestStore {
  fixtureIdExists(id: string): Promise<boolean>;
  insertHarvestedFixture(row: { id: string; version: number; fixture: unknown }): Promise<void>;
}

/** What the AI adjudicator reads and writes in the corpus. */
export interface AdjudicationStore {
  /** Ids of every fixture the adjudication has already filed. */
  adjudicatedIds(): Promise<string[]>;
  insertAdjudicatedPositive(row: {
    id: string;
    fixture: unknown;
    status: string;
    decidedAt: Date | null;
    decidedBy: string | null;
  }): Promise<void>;
  insertAdjudicatedNegative(row: { id: string; fixture: unknown }): Promise<void>;
  /** Analyst decisions on adjudicated positives: how many per final status. */
  analystTally(): Promise<{ status: string; n: number }[]>;
  /** Approvals the adjudicator made on its own go back to pending. */
  revokeAutonomousApprovals(): Promise<void>;
}

/** A corpus row as the review panel lists it. */
export interface CorpusFixtureRow {
  id: string;
  version: number;
  kind: "positive" | "negative";
  origin: string;
  observedAt: Date;
  fixture: unknown;
}

/** The analyst's queue of fixtures and their decisions. */
export interface PendingFixtureStore {
  countPending(): Promise<number>;
  listPending(limit: number): Promise<CorpusFixtureRow[]>;
  countAutoApproved(): Promise<number>;
  listAutoApproved(limit: number): Promise<CorpusFixtureRow[]>;
  /**
   * Sets the analyst's decision on a still-pending row, or on one the adjudicator approved on
   * its own. True when a row changed.
   */
  decide(id: string, version: number, status: "approved" | "rejected"): Promise<boolean>;
}

export interface StoredReport {
  id: string;
  generatedAt: Date;
  report: Record<string, unknown>;
}

/** Evaluation reports: written by a run, read by the health comparison and the trends. */
export interface EvaluationReportStore {
  insertReport(row: {
    id: string;
    generatedAt: string;
    seed: number;
    sampleSize: number;
    corpusVersion: number;
    report: unknown;
  }): Promise<void>;
  /** The newest report, or null when none is stored. */
  latestReport(): Promise<Record<string, unknown> | null>;
  /** The newest `limit` reports, oldest first. */
  newestReportsAscending(limit: number): Promise<Pick<StoredReport, "generatedAt" | "report">[]>;
  /** The newest `limit` reports, newest first. */
  recentReports(limit: number): Promise<StoredReport[]>;
}

/** A `verification_audit` row as the seed-set measurement reads it. */
export interface SeedAuditRow extends ControlledRow {
  in_seed: boolean;
  spec_key: string;
  spec_label: string;
  value: string;
  post_text: string | null;
  answer: "yes" | "no" | "cannot_tell" | null;
  obviously_wrong: boolean;
}

/** Read-only access to the frozen seed set; only the Evaluation page's measurement uses it. */
export interface SeedAuditReader {
  /** Every audit row, or null when the backend has no database. */
  seedAuditRows(): Promise<SeedAuditRow[] | null>;
}

export interface EvaluationRepo
  extends
    EvaluationLock,
    CorpusVersions,
    GitCorpusStore,
    HarvestStore,
    AdjudicationStore,
    PendingFixtureStore,
    EvaluationReportStore,
    SeedAuditReader {}
