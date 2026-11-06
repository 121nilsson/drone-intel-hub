import {
  AUDIT_BATCH,
  AUDIT_BUDGET,
  AUDIT_FIRST_DRAW,
  CONTROL_EVERY,
  FAMILY_ALARM,
  alteredReading,
  attributeFamily,
  failedControl,
  voidedByControls,
  sequentialDecision,
  controlMix,
  drawAuditSample,
  insertControls,
  readerDisagrees,
  errorRateUpperBound,
  seededRandom,
  textLanguage,
  type AuditCandidate,
  type ControlKind,
} from "@/entities/drone/audit";
import { figuresIn } from "@/entities/drone/value-in-quote";
import { ANALYST_SOURCE } from "@/entities/drone/claim-review";
import { claimReading } from "@/entities/drone/claim-reading";
import { attributeSemantic } from "@/entities/drone/spec-engine";
import type { Drone, EntailmentVerdict, SpecAttribute, SpecClaim } from "@/entities/drone/types";
import { entailmentAgreement } from "@/entities/drone/entailment";
import type {
  AuditAnswer,
  AuditDisagreement,
  AuditFailedControl,
  AuditItem,
  AuditSecondLook,
  AuditStatus,
  AuditTally,
} from "@/shared/contracts/verification";
import { db, dbConfigured, type Sql } from "@/shared/infra/postgres/db.server";

/**
 * The audit of `verified` claims and the frozen seed set (plan §9, Phase 2; migrations/019).
 *
 * The system draws, the person answers one question per claim, and the stopping rule in
 * entities/drone/audit.ts decides what the answers prove. Reads the catalogue, never writes it:
 * an audit answer is a measurement of the verifier, not a verdict on the claim, so it does not
 * become `SpecClaim.review` - every learning loop reads that, and none may read the seed set.
 */

/** Size of each part of the seed set beyond the first audit draw (plan §9). */
const SEED_NEGATIVES = { rejected: 25, uncertain: 25 } as const;

interface Drawable extends AuditCandidate {
  drone: Drone;
  spec: SpecAttribute;
  claim: SpecClaim & { id: string };
  state: "verified" | "uncertain" | "rejected";
  postText?: string;
  /**
   * The claim's reading with its figure changed to one the post does not contain, when it can
   * serve as a hidden control: a verified claim with a post and a measured figure. Shown with
   * its real quote, so the highlight is there and the mismatch is what the auditor must catch.
   */
  altered?: string;
  /** The identity check failed: the quote's sentence names another system than the claim's. */
  identityFailed: boolean;
}

/** Every machine-verified claim with a stable id, with its post's text and language. */
async function drawable(): Promise<Drawable[]> {
  const sql = db();
  const drones = (await sql<{ data: Drone }[]>`select data from drones`).map((r) => r.data);
  const claims = drones.flatMap((drone) =>
    drone.specs.flatMap((spec) =>
      spec.claims.flatMap((claim) =>
        claim.id &&
        claim.verification &&
        claim.source !== ANALYST_SOURCE &&
        claim.extractionEngine !== "analyst"
          ? [{ drone, spec, claim: claim as SpecClaim & { id: string } }]
          : [],
      ),
    ),
  );
  const ids = [...new Set(claims.flatMap(({ claim }) => (claim.sourceId ? [claim.sourceId] : [])))];
  const posts = new Map(
    ids.length
      ? (
          await sql<{ id: string; text: string | null }[]>`
            select id, data->>'text' as text from dispatches where id = any(${ids})`
        ).map((r) => [r.id, r.text ?? ""])
      : [],
  );
  return claims.map(({ drone, spec, claim }) => {
    const postText = (claim.sourceId && posts.get(claim.sourceId)) || undefined;
    const verification = claim.verification!;
    const measured = verification.checks.some(
      (c) => c.kind === "unit_dimension" && c.verdict === "pass",
    );
    const altered =
      verification.state === "verified" && measured && postText
        ? alteredReading(claimReading(spec, claim), figuresIn(postText))
        : undefined;
    return {
      claimId: claim.id,
      drone,
      spec,
      claim,
      state: verification.state,
      ...(postText ? { postText } : {}),
      language: textLanguage(postText ?? claim.evidence ?? claim.raw ?? String(claim.value)),
      family: attributeFamily(attributeSemantic(spec)),
      ...(altered ? { altered } : {}),
      identityFailed: verification.checks.some(
        (c) => c.kind === "identity" && c.verdict === "fail",
      ),
    };
  });
}

interface Placed {
  item: Drawable;
  role: "audit" | "control" | "negative";
  /** A control's kind; set on controls only. */
  controlKind?: ControlKind;
}

/** The quote the verifier checked: `evidence`, else `raw` - the one the page highlights. */
const quoteOf = (claim: SpecClaim) => claim.evidence?.trim() || claim.raw?.trim() || null;

async function insertBatch(
  sql: Sql,
  placed: Placed[],
  seed: number,
  inSeed: boolean,
): Promise<string> {
  const batchId = `audit-${new Date().toISOString().slice(0, 19)}-${seed.toString(36)}`;
  const rows = placed.map(({ item, role, controlKind }, position) => ({
    batch_id: batchId,
    position,
    draw_seed: seed,
    role,
    // Controls exist to test the auditor; they carry no ground truth worth freezing.
    in_seed: inSeed && role !== "control",
    drone_id: item.drone.id,
    drone_name: item.drone.name,
    spec_key: item.spec.key,
    spec_label: item.spec.label,
    claim_id: item.claimId,
    language: item.language,
    family: item.family,
    state_at_draw: item.state,
    verifier_version: item.claim.verification?.verifierVersion ?? null,
    // With its unit: a bare "40" cannot be judged (40 knots is not 40 km/h). A control shows
    // its altered figure; the snapshot is all the page ever reads, so the catalogue is untouched.
    value:
      controlKind === "altered" && item.altered
        ? item.altered
        : claimReading(item.spec, item.claim),
    control_kind: controlKind ?? null,
    evidence: quoteOf(item.claim),
    source: item.claim.source,
    source_id: item.claim.sourceId ?? null,
    post_text: item.postText ?? null,
  }));
  await sql`insert into verification_audit ${sql(rows)}`;
  return batchId;
}

/**
 * Hidden controls among `items`, at seeded positions: how many of each kind is controlMix's call
 * (one altered per CONTROL_EVERY audited claims, and a misread one in every batch of that size).
 */
function withControls(
  items: Placed[],
  altered: Drawable[],
  misread: Drawable[],
  seed: number,
): Placed[] {
  const mix = controlMix(items.length);
  const controls: Placed[] = [
    ...altered
      .slice(0, mix.altered)
      .map((item): Placed => ({ item, role: "control", controlKind: "altered" })),
    ...misread
      .slice(0, mix.misread)
      .map((item): Placed => ({ item, role: "control", controlKind: "misread" })),
  ];
  return insertControls(items, controls, seed);
}

const newSeed = () => Math.floor(Math.random() * 2 ** 31);

/**
 * Run a draw under one lock, in one transaction: two tabs or a double click must not both see "no
 * seed set yet" and freeze two, or both draw the same claims into separate batches.
 */
async function underDrawLock<T>(draw: (sql: Sql) => Promise<T>): Promise<T> {
  return (await db().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${"verification_audit:draw"}))`;
    return await draw(tx as unknown as Sql);
  })) as T;
}

async function auditedClaimIds(sql: Sql): Promise<Set<string>> {
  const rows = await sql<{ claim_id: string }[]>`select distinct claim_id from verification_audit`;
  return new Set(rows.map((r) => r.claim_id));
}

/**
 * The first session: the first audit draw, which is also the verified part of the seed set, plus
 * the seed set's rejected and uncertain claims, all shuffled together so the auditor cannot tell
 * which is which, with hidden controls. Drawn once; the seed set it creates is frozen.
 */
export async function drawFirstSession(): Promise<{ batchId: string; size: number }> {
  const all = await drawable();
  return await underDrawLock(async (sql) => {
    const [first] = await sql<{ n: number }[]>`select count(*)::int as n from verification_audit
      where in_seed`;
    if ((first?.n ?? 0) > 0)
      throw new Error("The first session has already been drawn; the seed set is frozen.");
    const seed = newSeed();
    const random = seededRandom(seed);
    const pick = (pool: Drawable[], size: number, exclude: ReadonlySet<string>, offset: number) => {
      const byId = new Map(pool.map((d) => [d.claimId, d]));
      return drawAuditSample(pool, size, seed + offset, exclude).map((c) => byId.get(c.claimId)!);
    };
    const audited = await auditedClaimIds(sql);
    const verified = pick(
      all.filter((d) => d.state === "verified" && d.postText),
      AUDIT_FIRST_DRAW,
      audited,
      0,
    );
    if (!verified.length) throw new Error("There are no verified claims with a post to audit yet.");
    const controls = pick(
      all.filter((d) => d.altered),
      Math.ceil(AUDIT_FIRST_DRAW / CONTROL_EVERY),
      new Set([...audited, ...verified.map((d) => d.claimId)]),
      1,
    );
    const taken = new Set([
      ...audited,
      ...verified.map((d) => d.claimId),
      ...controls.map((d) => d.claimId),
    ]);
    // Negatives with a post where possible: one with nothing to read can only be "cannot tell".
    const negatives = (["rejected", "uncertain"] as const).flatMap((state, i) =>
      pick(
        all.filter((d) => d.state === state && d.postText),
        SEED_NEGATIVES[state],
        taken,
        2 + i,
      ),
    );
    const mixed: Placed[] = [
      ...verified.map((item) => ({ item, role: "audit" as const })),
      ...negatives.map((item) => ({ item, role: "negative" as const })),
    ]
      .map((p) => ({ p, k: random() }))
      .sort((a, b) => a.k - b.k)
      .map(({ p }) => p);
    // The first session keeps its own kind of control: the seed set it freezes was built without
    // misread ones, and a later batch carries them (drawMore).
    const placed = withControls(mixed, controls, [], seed);
    const batchId = await insertBatch(sql, placed, seed, true);
    return { batchId, size: placed.length };
  });
}

/** Another batch of verified claims never drawn before, with its hidden controls. */
export async function drawMore(size = AUDIT_BATCH): Promise<{ batchId: string; size: number }> {
  const all = await drawable();
  const byId = new Map(all.map((d) => [d.claimId, d]));
  return await underDrawLock(async (sql) => {
    const audited = await auditedClaimIds(sql);
    const seed = newSeed();
    const verified = drawAuditSample(
      all.filter((d) => d.state === "verified" && d.postText),
      size,
      seed,
      audited,
    ).map((c) => byId.get(c.claimId)!);
    if (!verified.length) throw new Error("Every verified claim with a post has been audited.");
    // A control is a verified claim too, so it is drawn from the claims this batch did not take.
    const mix = controlMix(size);
    const taken = new Set([...audited, ...verified.map((d) => d.claimId)]);
    const altered = drawAuditSample(
      all.filter((d) => d.altered),
      mix.altered,
      seed + 1,
      taken,
    ).map((c) => byId.get(c.claimId)!);
    // A misread control is a rejected claim whose sentence names another system, with a post to
    // read: the person must say "no" to it, and a "yes" shows the system-versus-variant habit.
    const misread = drawAuditSample(
      all.filter((d) => d.state === "rejected" && d.identityFailed && d.postText),
      mix.misread,
      seed + 2,
      new Set([...taken, ...altered.map((d) => d.claimId)]),
    ).map((c) => byId.get(c.claimId)!);
    const placed = withControls(
      verified.map((item) => ({ item, role: "audit" as const })),
      altered,
      misread,
      seed,
    );
    const batchId = await insertBatch(sql, placed, seed, false);
    return { batchId, size: placed.length };
  });
}

export async function answerAudit(input: {
  id: string;
  answer: AuditAnswer;
  obviouslyWrong: boolean;
  readVia: "original" | "translation";
}): Promise<void> {
  const rows = await db()`update verification_audit
       set answer = ${input.answer}, obviously_wrong = ${input.obviouslyWrong},
           read_via = ${input.readVia}, answered_at = now()
     where id = ${input.id}
     returning id`;
  if (!rows.length) throw new Error("No such audit item");
}

/**
 * The owner's dispute of a failed 'misread' control: the post did state the figure for this
 * system, so the control was wrong and voids nothing. An 'altered' control is wrong by
 * construction and cannot be disputed. `disputed: false` withdraws a dispute.
 */
export async function disputeControl(input: { id: string; disputed: boolean }): Promise<void> {
  const rows = await db()`update verification_audit
       set control_disputed_at = ${input.disputed ? new Date() : null}
     where id = ${input.id} and role = 'control' and coalesce(control_kind, 'misread') = 'misread'
     returning id`;
  if (!rows.length) throw new Error("Only a control of the first sessions' kind can be disputed");
}

interface AuditRow {
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
  /** The second reader's current verdict on this claim, joined in from the catalogue. */
  reader?: EntailmentVerdict | null;
  /** Whether that reader is known to differ from the claim's extractor. */
  reader_independence?: "checked" | "unknown" | null;
  obviously_wrong: boolean;
  read_via: "original" | "translation" | null;
  drawn_at: Date;
  control_kind?: ControlKind | null;
  control_disputed_at?: Date | null;
}

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

const drawOrder = (a: AuditRow, b: AuditRow) =>
  +a.drawn_at - +b.drawn_at || a.batch_id.localeCompare(b.batch_id) || a.position - b.position;

/** Pure: what a set of audit rows proves. Exported for tests. */
export function summarizeAudit(rows: AuditRow[], undrawn?: number): AuditStatus {
  // A control answered "yes" voids the answers around it, not its whole batch (CONTROL_WINDOW).
  const voided = voidedByControls(rows);
  const scored = rows.filter((r) => r.role === "audit" && !voided.has(r.id)).sort(drawOrder);
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
  // Decided only at the batch boundaries, over the answers in draw order (entities/drone/audit.ts).
  const { decision, decidedAt } = sequentialDecision(
    scored.filter((r) => r.answer === "yes" || r.answer === "no").map((r) => r.answer === "no"),
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
  const pairs = rows.flatMap((r) =>
    r.role !== "control" &&
    !voided.has(r.id) &&
    (r.answer === "yes" || r.answer === "no") &&
    r.reader
      ? [{ human: r.answer, reader: r.reader, unknown: r.reader_independence === "unknown" }]
      : [],
  );
  const agreement = entailmentAgreement(pairs);
  const said = agreement.supported.yes + agreement.supported.no;
  return {
    available: true,
    decision,
    ...(decidedAt ? { decidedAt } : {}),
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
    ...(pairs.length
      ? {
          reader: {
            agreement,
            measured: pairs.length,
            independenceUnknown: pairs.filter((p) => p.unknown).length,
            supportedErrorBound: errorRateUpperBound(said, agreement.supported.no),
          },
        }
      : {}),
    ...(undrawn !== undefined ? { undrawn } : {}),
  };
}

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

/**
 * The audit's state. Read after every answer, so it stays small: no post text except the next
 * claim's, and the count of claims never drawn - a scan of the catalogue - only when asked for.
 */
export async function auditStatus(opts: { countUndrawn?: boolean } = {}): Promise<AuditStatus> {
  if (!dbConfigured()) return EMPTY;
  const sql = db();
  const rows = await sql<AuditRow[]>`select id, batch_id, position, role, in_seed, drone_id,
      drone_name, spec_label, claim_id, language, family, value, evidence, source, source_id,
      answer, obviously_wrong, read_via, drawn_at, control_kind, control_disputed_at
    from verification_audit`;
  // Only the entries the audit drew from are unnested: this runs after every answer, and a scan
  // of the whole catalogue there is what the status read is kept small to avoid.
  const ids = [...new Set(rows.map((r) => r.claim_id))];
  const droneIds = [...new Set(rows.map((r) => r.drone_id))];
  const readings = new Map(
    ids.length
      ? (
          await sql<
            {
              id: string;
              verdict: EntailmentVerdict | null;
              independence: "checked" | "unknown" | null;
            }[]
          >`
            select c->>'id' as id, c->'entailment'->>'verdict' as verdict,
                   c->'entailment'->>'independence' as independence
              from drones d,
                   jsonb_array_elements(d.data->'specs') s,
                   jsonb_array_elements(s->'claims') c
             where d.id = any(${droneIds}) and c->>'id' = any(${ids}) and c ? 'entailment'`
        ).map((r) => [r.id, r] as const)
      : [],
  );
  for (const r of rows) {
    const reading = readings.get(r.claim_id);
    r.reader = reading?.verdict ?? null;
    r.reader_independence = reading?.independence ?? null;
  }
  const status = summarizeAudit(rows, opts.countUndrawn ? await countUndrawn() : undefined);
  if (status.next) {
    const [post] = await sql<{ post_text: string | null }[]>`select post_text
      from verification_audit where id = ${status.next.id}`;
    if (post?.post_text) status.next.postText = post.post_text;
  }
  return status;
}

/** Verified claims with a post, never drawn: what another batch could still draw from. */
async function countUndrawn(): Promise<number> {
  const [counted] = await db()<{ undrawn: number }[]>`
    select count(*)::int as undrawn
      from drones d,
           jsonb_array_elements(d.data->'specs') s,
           jsonb_array_elements(s->'claims') c
      join dispatches p on p.id = c->>'sourceId' and coalesce(p.data->>'text', '') <> ''
     where c->'verification'->>'state' = 'verified'
       and c->>'id' is not null
       and not exists (select 1 from verification_audit a where a.claim_id = c->>'id')`;
  return counted?.undrawn ?? 0;
}

/**
 * The claims the person answered and the second reader contradicted, with the post each was drawn
 * with. Controls are left out (they test the person, not the claim) and so are answers a failed
 * control voided: nothing there counts, so there is nothing to second-guess.
 */
export async function auditDisagreements(): Promise<AuditDisagreement[]> {
  if (!dbConfigured()) return [];
  const sql = db();
  const rows = await sql<
    (AuditRow & {
      post_text: string | null;
      second_look: AuditSecondLook | null;
      control_kind: "altered" | "misread" | null;
    })[]
  >`select id, batch_id, position, role, in_seed, drone_id, drone_name, spec_label, claim_id,
      language, family, value, evidence, source, source_id, post_text, answer, obviously_wrong,
      read_via, drawn_at, control_kind, control_disputed_at, second_look
    from verification_audit where answer is not null`;
  const voided = voidedByControls(rows);
  const answered = rows.filter(
    (r) => r.role !== "control" && !voided.has(r.id) && (r.answer === "yes" || r.answer === "no"),
  );
  if (!answered.length) return [];
  const ids = answered.map((r) => r.claim_id);
  const readings = new Map(
    (
      await sql<
        {
          id: string;
          verdict: EntailmentVerdict | null;
          span: string | null;
          note: string | null;
        }[]
      >`select c->>'id' as id, c->'entailment'->>'verdict' as verdict,
               c->'entailment'->>'span' as span, c->'entailment'->>'note' as note
          from drones d,
               jsonb_array_elements(d.data->'specs') s,
               jsonb_array_elements(s->'claims') c
         where d.id = any(${[...new Set(answered.map((r) => r.drone_id))]})
           and c->>'id' = any(${ids}) and c ? 'entailment'`
    ).map((r) => [r.id, r] as const),
  );
  return answered.flatMap((r) => {
    const reading = readings.get(r.claim_id);
    if (!reading || !readerDisagrees(r.answer, reading.verdict)) return [];
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
        reader: reading.verdict as "supported" | "unsupported",
        ...(reading.span ? { readerSpan: reading.span } : {}),
        ...(reading.note ? { readerNote: reading.note } : {}),
        ...(r.second_look ? { secondLook: r.second_look } : {}),
      },
    ];
  });
}

/**
 * The person's second look at a contradicted answer, or null to clear it. A note about the reader
 * and about the person's own habits: it does not change `answer`, which is what the audit counts.
 */
export async function setSecondLook(input: {
  id: string;
  look: AuditSecondLook | null;
}): Promise<void> {
  const rows = await db()`update verification_audit set second_look = ${input.look}
     where id = ${input.id} and role <> 'control' and answer in ('yes', 'no') returning id`;
  if (!rows.length) throw new Error("No such answered audit item");
}

export type { AuditRow };
