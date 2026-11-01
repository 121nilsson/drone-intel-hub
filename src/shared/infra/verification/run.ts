import type { Drone } from "@/entities/drone/types";
import {
  VERIFIER_VERSION,
  verificationCoverage,
  verificationExceptions,
} from "@/entities/drone/verification";
import type {
  VerificationCoverageCounts,
  VerificationRunRecord,
  VerificationExceptionRow,
  VerificationRunReport,
} from "@/shared/contracts/verification";
import type { DispatchRepository, DroneRepository } from "@/shared/contracts/repository";
import { backfillCatalogue } from "./backfill";

/** How many exceptions are sent to the page; the count never is. */
const MAX_EXCEPTIONS = 100;

/** The part of a coverage snapshot a run records in the ledger. */
const countsOf = (c: {
  verified: number;
  uncertain: number;
  rejected: number;
  unverified: number;
}): VerificationCoverageCounts => ({
  verified: c.verified,
  uncertain: c.uncertain,
  rejected: c.rejected,
  unverified: c.unverified,
});

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** Assemble the report the Autonomy page shows, over the whole catalogue. */
export function verificationReport(
  drones: readonly Drone[],
  run: { at: string; checked: number; changed: number; missingText: number },
): VerificationRunReport {
  const coverage = verificationCoverage(drones);
  const exceptions = verificationExceptions(drones).sort((a, b) =>
    a.verification.state === b.verification.state
      ? b.verification.independentSources - a.verification.independentSources
      : a.verification.state === "rejected"
        ? -1
        : 1,
  );
  const rows: VerificationExceptionRow[] = exceptions.slice(0, MAX_EXCEPTIONS).map((e) => ({
    droneId: e.droneId,
    droneName: e.droneName,
    specKey: e.specKey,
    specLabel: e.specLabel,
    value: e.claim.raw ?? String(e.claim.value),
    source: e.claim.source,
    date: e.claim.date,
    state: e.verification.state,
    ...(e.check ? { checkKind: e.check.kind, detail: e.check.detail } : {}),
    ...(e.check?.evidence ? { evidence: e.check.evidence } : {}),
    ...(e.claim.sourceId ? { sourceId: e.claim.sourceId } : {}),
    independentSources: e.verification.independentSources,
    verifierVersion: e.verification.verifierVersion,
  }));
  const checked = coverage.checked;
  return {
    ...run,
    ran: true,
    coverage,
    decided: checked ? (coverage.verified + coverage.rejected) / checked : 0,
    rejected: coverage.rejected,
    uncertain: coverage.uncertain,
    medianIndependentSources: median(
      drones.flatMap((d) =>
        d.specs.flatMap((s) =>
          s.claims.flatMap((c) =>
            c.verification?.state === "verified" ? [c.verification.independentSources] : [],
          ),
        ),
      ),
    ),
    exceptions: rows,
    exceptionCount: exceptions.length,
    truncated: exceptions.length > rows.length,
  };
}

/** A report before anything has been run, for the page's first render. */
export const EMPTY_VERIFICATION: VerificationRunReport = {
  ran: false,
  reason: "not run yet",
  at: new Date(0).toISOString(),
  checked: 0,
  changed: 0,
  missingText: 0,
  coverage: {
    total: 0,
    analyst: 0,
    unverified: 0,
    verified: 0,
    uncertain: 0,
    rejected: 0,
    checked: 0,
  },
  decided: 0,
  rejected: 0,
  uncertain: 0,
  medianIndependentSources: 0,
  exceptions: [],
  exceptionCount: 0,
  truncated: false,
};

/**
 * Verify the catalogue and record the run in the autonomy ledger. The catalogue write is the
 * point; the ledger event is best-effort, so a database without the migration still lets the
 * analyst run the check.
 *
 * `record` writes the ledger row, and is always passed: the browser goes through the server
 * function (services.tsx), the server writes the ledger directly (verify.server.ts). A default
 * here would pull the browser's server-function bridge into the server task's bundle.
 */
export async function runCatalogueVerification(
  deps: {
    drones: Pick<DroneRepository, "list" | "upsert">;
    dispatches: Pick<DispatchRepository, "list">;
  },
  record: (run: VerificationRunRecord) => Promise<void>,
): Promise<VerificationRunReport> {
  // Before the write, so the ledger row itself carries the drop a stricter verifier causes.
  const before = verificationCoverage(deps.drones.list());
  const result = await backfillCatalogue(deps);
  const report = verificationReport(deps.drones.list(), {
    at: new Date().toISOString(),
    checked: result.checked,
    changed: result.changed.length,
    missingText: result.missingText,
  });
  try {
    await record({
      at: report.at,
      verifierVersion: VERIFIER_VERSION,
      checked: report.checked,
      changed: report.changed,
      missingText: report.missingText,
      before: countsOf(before),
      after: countsOf(report.coverage),
    });
  } catch {
    /* the ledger is best-effort; the run already happened */
  }
  return report;
}
