import {
  AUDIT_BUDGET,
  FAMILY_ALARM,
  errorRateUpperBound,
  failedControl,
  sequentialDecision,
  voidedByControls,
  type AuditLanguage,
} from "@/entities/drone/audit";
import {
  finalAnswers,
  formalGate,
  formalStratum,
  type FormalDesign,
  type Presentation,
} from "@/entities/drone/audit-design";
import { entailmentAgreement } from "@/entities/drone/entailment";
import type { AuditRow } from "@/shared/contracts/audit-repo";
import type {
  AuditFailedControl,
  AuditItem,
  AuditStatus,
  AuditTally,
} from "@/shared/contracts/verification";

/**
 * What a set of audit rows proves (plan §9): the tally, the stopping rule, the formal gate and the
 * second reader's agreement, all pure. The draw and the status read share these.
 */
const toItem = (r: AuditRow): AuditItem => ({
  id: r.id,
  batchId: r.batch_id,
  position: r.position,
  droneId: r.drone_id,
  droneName: r.drone_name,
  specLabel: r.spec_label,
  value: r.value,
  ...(r.evidence ? { evidence: r.evidence } : {}),
  source: r.source,
  ...(r.source_id ? { sourceId: r.source_id } : {}),
  ...(r.post_text ? { postText: r.post_text } : {}),
  language: r.language,
  family: r.family,
  ...(r.answer ? { answer: r.answer } : {}),
  obviouslyWrong: r.obviously_wrong,
  ...(r.read_via ? { readVia: r.read_via } : {}),
  ...(r.sample_unit_id ? { sampleUnitId: r.sample_unit_id } : {}),
});

const tally = (rows: AuditRow[]): AuditTally => {
  const answered = rows.filter((r) => r.answer === "yes" || r.answer === "no").length;
  const errors = rows.filter((r) => r.answer === "no").length;
  return {
    answered,
    errors,
    cannotTell: rows.filter((r) => r.answer === "cannot_tell").length,
    upperBound: errorRateUpperBound(answered, errors),
  };
};

export const drawOrder = (a: AuditRow, b: AuditRow) =>
  +a.drawn_at - +b.drawn_at || a.batch_id.localeCompare(b.batch_id) || a.position - b.position;

/**
 * Pure: the formal evaluation's progress and its single analysis, from the rows drawn under one
 * design. One answer per sample unit counts (finalAnswers): a unit shown again after a failed
 * control voided its answer is the same unit, not another observation.
 */
export function formalStatus(
  design: { id: string; design: FormalDesign },
  rows: readonly AuditRow[],
  voided: ReadonlySet<string>,
): NonNullable<AuditStatus["formal"]> {
  const unitRows = rows
    .filter((r) => r.audit_batch_id === design.id && r.role === "audit" && r.sample_unit_id)
    .sort(drawOrder);
  const presentations: Presentation[] = unitRows.map((r, order) => ({
    sampleUnitId: r.sample_unit_id!,
    stratum: r.unit_stratum ?? formalStratum(r.language as AuditLanguage),
    answer: r.answer,
    voided: voided.has(r.id),
    order,
  }));
  const finals = finalAnswers(presentations);
  const gate = formalGate(design.design, finals);
  const open = new Set(unitRows.filter((r) => !r.answer).map((r) => r.sample_unit_id!));
  const retryPending = [...finals.entries()].filter(
    ([unit, f]) => f.outcome === null && !open.has(unit),
  ).length;
  return { ...gate, designId: design.id, retryPending };
}

/** Pure: what a set of audit rows proves. Exported for tests. */
export function summarizeAudit(
  rows: AuditRow[],
  undrawn?: number,
  formalDesign?: { id: string; design: FormalDesign },
): AuditStatus {
  // A control answered "yes" voids the answers around it, not its whole batch (CONTROL_WINDOW).
  const voided = voidedByControls(rows);
  const scored = rows.filter((r) => r.role === "audit" && !voided.has(r.id)).sort(drawOrder);
  const formal = formalDesign ? formalStatus(formalDesign, rows, voided) : undefined;
  const failedControls: AuditFailedControl[] = rows
    .filter((r) => r.role === "control" && r.answer === "yes")
    .sort(drawOrder)
    .map((r) => ({
      id: r.id,
      batchId: r.batch_id,
      droneName: r.drone_name,
      specLabel: r.spec_label,
      value: r.value,
      ...(r.evidence ? { evidence: r.evidence } : {}),
      source: r.source,
      ...(r.source_id ? { sourceId: r.source_id } : {}),
      kind: r.control_kind ?? "misread",
      disputed: !failedControl(r),
    }));
  const overall = tally(scored);
  // The old look at the first, non-probability draws: kept as information, never the gate. Looking
  // at a fresh 95 % bound at every boundary spends the 5 % risk several times over.
  const interim = sequentialDecision(
    scored
      .filter((r) => r.sampling_purpose !== "formal_eval")
      .filter((r) => r.answer === "yes" || r.answer === "no")
      .map((r) => r.answer === "no"),
  );
  const open = rows.filter((r) => !r.answer).sort(drawOrder);
  const groups = (key: (r: AuditRow) => string) => {
    const by = new Map<string, AuditRow[]>();
    for (const r of scored) by.set(key(r), [...(by.get(key(r)) ?? []), r]);
    return [...by.entries()];
  };
  const seed = rows.filter((r) => r.in_seed);
  // The reader is measured on every claim a person answered in a counted batch - verified ones
  // and seed negatives alike, never a control, which tests the person rather than the claim.
  const counted = rows.filter(
    (r) => r.role !== "control" && !voided.has(r.id) && (r.answer === "yes" || r.answer === "no"),
  );
  const pairs = counted.flatMap((r) =>
    r.reader
      ? [
          {
            human: r.answer as "yes" | "no",
            reader: r.reader,
            unknown: r.reader_independence === "unknown",
          },
        ]
      : [],
  );
  const agreement = entailmentAgreement(pairs);
  const said = agreement.supported.yes + agreement.supported.no;
  // Readings after the draw: the claim was read once the person's answer was already in or at
  // least possible, so they are shown apart. `blind` is the part read before the person answered.
  const afterPairs = counted.flatMap((r) => {
    const reading = r.reader_after_draw?.at(-1);
    return reading
      ? [
          {
            human: r.answer as "yes" | "no",
            reader: reading.verdict,
            blind: reading.before_human_answer === true,
          },
        ]
      : [];
  });
  const legacyPairs = counted.flatMap((r) =>
    r.reader_legacy ? [{ human: r.answer as "yes" | "no", reader: r.reader_legacy }] : [],
  );
  const hasReader = pairs.length || afterPairs.length || legacyPairs.length;
  return {
    available: true,
    decision: formal?.decision ?? "continue",
    ...(formal ? { formal } : {}),
    interim: {
      decision: interim.decision,
      ...(interim.decidedAt ? { decidedAt: interim.decidedAt } : {}),
    },
    budget: AUDIT_BUDGET,
    overall,
    byLanguage: groups((r) => r.language).map(([language, rs]) => ({ language, ...tally(rs) })),
    byFamily: groups((r) => r.family).map(([family, rs]) => {
      const first = rs.filter((r) => r.answer === "yes" || r.answer === "no");
      const early = first.slice(0, FAMILY_ALARM.within).filter((r) => r.answer === "no").length;
      return { family, ...tally(rs), alarm: early >= FAMILY_ALARM.errors };
    }),
    viaTranslation: scored.filter((r) => r.answer && r.read_via === "translation").length,
    obviouslyWrong: scored.filter((r) => r.obviously_wrong).length,
    failedControls,
    voidedAnswers: rows.filter((r) => voided.has(r.id) && r.answer).length,
    ...(open[0] ? { next: toItem(open[0]) } : {}),
    openCount: open.length,
    seed: {
      size: seed.length,
      answered: seed.filter((r) => r.answer).length,
      frozen: seed.length > 0,
    },
    ...(hasReader
      ? {
          reader: {
            agreement,
            ...(afterPairs.length
              ? {
                  afterDraw: {
                    agreement: entailmentAgreement(afterPairs),
                    measured: afterPairs.length,
                    blind: afterPairs.filter((p) => p.blind).length,
                  },
                }
              : {}),
            ...(legacyPairs.length
              ? {
                  legacy: {
                    agreement: entailmentAgreement(legacyPairs),
                    measured: legacyPairs.length,
                  },
                }
              : {}),
            measured: pairs.length,
            independenceUnknown: pairs.filter((p) => p.unknown).length,
            supportedErrorBound: errorRateUpperBound(said, agreement.supported.no),
          },
        }
      : {}),
    ...(undrawn !== undefined ? { undrawn } : {}),
  };
}
