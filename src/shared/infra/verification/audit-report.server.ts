import { AUDIT_BUDGET, readerDisagrees, voidedByControls } from "@/entities/drone/audit";
import type { StoredEntailmentVerdict } from "@/entities/drone/types";
import type { AuditRow, ReaderRecord } from "@/shared/contracts/audit-repo";
import type { AuditDisagreement, AuditStatus } from "@/shared/contracts/verification";
import { serverServices } from "@/shared/infra/server-services.server";
import { drawOrder, summarizeAudit } from "./audit-analysis.server";

/**
 * The audit's state back from storage, and the claims the second reader contradicted. Read only:
 * nothing here draws, answers or writes, and nothing a learning loop reads comes from here.
 */

const EMPTY: AuditStatus = {
  available: false,
  decision: "continue",
  budget: AUDIT_BUDGET,
  overall: { answered: 0, errors: 0, cannotTell: 0, upperBound: 1 },
  byLanguage: [],
  byFamily: [],
  viaTranslation: 0,
  obviouslyWrong: 0,
  failedControls: [],
  voidedAnswers: 0,
  openCount: 0,
  seed: { size: 0, answered: 0, frozen: false },
};

const storedVerdict = (v: ReaderRecord["verdict"]): StoredEntailmentVerdict =>
  v === "legacy_unsupported" ? "unsupported" : v;

/**
 * Put each row's frozen readings on it. A re-asked sample unit has no reading of its own at draw:
 * it takes the one its first presentation was drawn with, which is the reading the unit had when
 * it was sampled.
 */
async function attachReaders(rows: AuditRow[]): Promise<void> {
  const records = await serverServices().audit.readerRecords(
    rows.filter((r) => r.role !== "control").map((r) => r.id),
  );
  const byAudit = new Map<string, ReaderRecord[]>();
  for (const rec of records) byAudit.set(rec.audit_id, [...(byAudit.get(rec.audit_id) ?? []), rec]);
  const atDrawOfUnit = new Map<string, ReaderRecord>();
  for (const r of [...rows].sort(drawOrder)) {
    const at = byAudit.get(r.id)?.find((x) => x.phase === "at_draw");
    if (at && r.sample_unit_id && !atDrawOfUnit.has(r.sample_unit_id))
      atDrawOfUnit.set(r.sample_unit_id, at);
  }
  for (const r of rows) {
    const own = byAudit.get(r.id) ?? [];
    const at =
      own.find((x) => x.phase === "at_draw") ??
      (r.sample_unit_id ? atDrawOfUnit.get(r.sample_unit_id) : undefined);
    r.reader = at ? storedVerdict(at.verdict) : null;
    r.reader_independence = at?.independence ?? null;
    r.reader_after_draw = own
      .filter((x) => x.phase === "after_draw")
      .map((x) => ({
        verdict: storedVerdict(x.verdict),
        evaluated_at: x.evaluated_at,
        before_human_answer: x.before_human_answer,
      }));
    const legacy = own.filter((x) => x.phase === "backfill").at(-1);
    r.reader_legacy = legacy ? storedVerdict(legacy.verdict) : null;
  }
}

/**
 * The audit's state. Read after every answer, so it stays small: no post text except the next
 * claim's, and the count of claims never drawn - a scan of the catalogue - only when asked for.
 */
export async function auditStatus(opts: { countUndrawn?: boolean } = {}): Promise<AuditStatus> {
  const audit = serverServices().audit;
  // No audit storage (no database): the empty status, before anything is read.
  const rows = await audit.statusRows();
  if (!rows) return EMPTY;
  // The reader's verdicts come from what was frozen when each claim was drawn and appended since
  // (verification_audit_reader), never from the catalogue as it is now.
  await attachReaders(rows);
  const design = await audit.latestFormalDesign();
  const status = summarizeAudit(
    rows,
    opts.countUndrawn ? await audit.countUndrawn() : undefined,
    design ? { id: design.id, design: design.sampling_design } : undefined,
  );
  if (status.next) {
    const postText = await audit.postTextOf(status.next.id);
    if (postText) status.next.postText = postText;
  }
  return status;
}

/**
 * The claims the person answered and the second reader contradicted, with the post each was drawn
 * with. Controls are left out (they test the person, not the claim) and so are answers a failed
 * control voided: nothing there counts, so there is nothing to second-guess.
 */
export async function auditDisagreements(): Promise<AuditDisagreement[]> {
  const audit = serverServices().audit;
  // With no audit storage nothing was answered, so nothing was contradicted.
  const rows = await audit.answeredRows();
  const voided = voidedByControls(rows);
  const answered = rows.filter(
    (r) => r.role !== "control" && !voided.has(r.id) && (r.answer === "yes" || r.answer === "no"),
  );
  if (!answered.length) return [];
  // What the reader had said when each claim was drawn, from the frozen history; a later reading
  // is attached to the row apart, with its time, and never stands in for the one at draw.
  // A claim shown again after a failed control has no reading of its own at draw: it takes the one
  // its sample unit was drawn with, from the unit's first presentation.
  const units = [...new Set(answered.flatMap((r) => (r.sample_unit_id ? [r.sample_unit_id] : [])))];
  const siblings = units.length ? await audit.unitSiblings(units) : [];
  const records = await audit.readerRecords([
    ...new Set([...answered.map((r) => r.id), ...siblings.map((s) => s.id)]),
  ]);
  const byAudit = new Map<string, ReaderRecord[]>();
  for (const rec of records) byAudit.set(rec.audit_id, [...(byAudit.get(rec.audit_id) ?? []), rec]);
  const atDrawOfUnit = new Map<string, ReaderRecord>();
  for (const sib of siblings) {
    const at = byAudit.get(sib.id)?.find((x) => x.phase === "at_draw");
    if (at && !atDrawOfUnit.has(sib.sample_unit_id)) atDrawOfUnit.set(sib.sample_unit_id, at);
  }
  return answered.flatMap((r) => {
    const own = byAudit.get(r.id) ?? [];
    const atDraw =
      own.find((x) => x.phase === "at_draw") ??
      (r.sample_unit_id ? atDrawOfUnit.get(r.sample_unit_id) : undefined);
    const after = own.filter((x) => x.phase === "after_draw");
    const verdict = atDraw ? storedVerdict(atDraw.verdict) : undefined;
    if (!atDraw || !readerDisagrees(r.answer, verdict)) return [];
    return [
      {
        id: r.id,
        droneId: r.drone_id,
        droneName: r.drone_name,
        specLabel: r.spec_label,
        value: r.value,
        ...(r.evidence ? { evidence: r.evidence } : {}),
        source: r.source,
        ...(r.post_text ? { postText: r.post_text } : {}),
        answer: r.answer as "yes" | "no",
        reader: verdict as Exclude<StoredEntailmentVerdict, "uncertain">,
        ...(atDraw.span ? { readerSpan: atDraw.span } : {}),
        ...(atDraw.note ? { readerNote: atDraw.note } : {}),
        readerEvaluatedAt: new Date(atDraw.evaluated_at).toISOString(),
        ...(after.length
          ? {
              readerAfterDraw: after.map((x) => ({
                verdict: storedVerdict(x.verdict),
                evaluatedAt: new Date(x.evaluated_at).toISOString(),
                beforeHumanAnswer: x.before_human_answer === true,
              })),
            }
          : {}),
        ...(r.second_look ? { secondLook: r.second_look } : {}),
      },
    ];
  });
}
