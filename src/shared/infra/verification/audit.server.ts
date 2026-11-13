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
  type AuditLanguage,
  type ControlKind,
} from "@/entities/drone/audit";
import { randomInt } from "node:crypto";
import {
  FORMAL_SAMPLE_SIZE,
  drawFormalSample,
  finalAnswers,
  formalGate,
  formalStratum,
  type FormalDesign,
  type Presentation,
} from "@/entities/drone/audit-design";
import { figuresIn } from "@/entities/drone/value-in-quote";
import { ANALYST_SOURCE } from "@/entities/drone/claim-review";
import { claimReading } from "@/entities/drone/claim-reading";
import { attributeSemantic } from "@/entities/drone/spec-engine";
import type {
  ClaimEntailment,
  Drone,
  SpecAttribute,
  SpecClaim,
  StoredEntailmentVerdict,
} from "@/entities/drone/types";
import { entailmentAgreement, textHash } from "@/entities/drone/entailment";
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
import {
  appendReaderRows,
  claimFingerprint,
  readerRow,
  readerStateAtDraw,
  sha256,
  type ReaderRow,
  type ReaderStateAtDraw,
} from "./audit-freeze.server";

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

interface BatchOptions {
  /** Verified claims with a post at the draw, recorded on the batch (required for a new draw). */
  populationSize: number;
  inSeed: boolean;
  /** formal_eval: the probability sample the gate is computed over. diagnostic: never in the bound. */
  purpose: "formal_eval" | "diagnostic";
  /** The design's audit_batches row (formal); a diagnostic batch gets a row of its own. */
  auditBatchId?: string;
  /** Sample unit of each claim, for a formal draw. */
  units?: ReadonlyMap<string, string>;
}

const newBatchId = (seed: number, tag = "audit") =>
  `${tag}-${new Date().toISOString().slice(0, 19)}-${seed.toString(36)}`;

/**
 * Write a batch and freeze, per row, what the claim was and what the second reader had said about
 * it (migrations/026). A reading the claim already carried is stored as the reader's reading at
 * draw only when it was made for this claim version and post text (readerStateAtDraw); an older
 * one is kept as history that does not claim to describe the claim as drawn.
 */
async function insertBatch(
  sql: Sql,
  placed: Placed[],
  seed: number,
  opts: BatchOptions,
): Promise<string> {
  const batchId = newBatchId(seed);
  let auditBatchId = opts.auditBatchId;
  if (!auditBatchId) {
    const [created] = await sql<{ id: string }[]>`
      insert into audit_batches
        (purpose, sampling_design, population_size, sample_size, seed, legacy_batch_id)
      values (${opts.purpose}, ${sql.json({ draw: "round_robin", batchId })},
              ${opts.populationSize}, ${placed.length}, ${seed}, null)
      returning id`;
    auditBatchId = created!.id;
  }
  const frozen = placed.map(({ item }) => {
    const postText = item.postText ?? "";
    const fingerprint = claimFingerprint(item.drone, item.spec, item.claim, postText);
    return {
      fingerprint,
      state: readerStateAtDraw(item.claim, postText, fingerprint) as ReaderStateAtDraw,
    };
  });
  const rows = placed.map(({ item, role, controlKind }, position) => ({
    batch_id: batchId,
    position,
    draw_seed: seed,
    role,
    // Controls exist to test the auditor; they carry no ground truth worth freezing.
    in_seed: opts.inSeed && role !== "control",
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
    audit_batch_id: auditBatchId,
    sampling_purpose: opts.purpose,
    sample_unit_id: role === "audit" ? (opts.units?.get(item.claimId) ?? null) : null,
    claim_fingerprint: frozen[position]!.fingerprint,
    source_text_hash: sha256(item.postText ?? ""),
    reader_state_at_draw: frozen[position]!.state,
  }));
  const inserted = await sql<{ id: string; position: number }[]>`
    insert into verification_audit ${sql(rows)} returning id, position`;
  const readerRows: ReaderRow[] = [];
  for (const { id, position } of inserted) {
    const { item, role } = placed[position]!;
    const entailment: ClaimEntailment | undefined = item.claim.entailment;
    // A control tests the person, not the claim: nothing about the reader is frozen for it.
    if (!entailment || role === "control") continue;
    const state = frozen[position]!.state;
    const context = { postText: item.postText ?? "", answeredAt: null };
    if (state === "verified_snapshot")
      readerRows.push(readerRow(id, entailment, "at_draw", context));
    else readerRows.push(readerRow(id, entailment, "backfill", context));
  }
  await appendReaderRows(sql, readerRows);
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

/**
 * A seed from the system's secure source, stored with the draw and then only used to make the draw
 * repeatable. A sample whose seed could be guessed beforehand could be steered.
 */
const newSeed = () => randomInt(0, 2 ** 31);

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
    const batchId = await insertBatch(sql, placed, seed, {
      inSeed: true,
      purpose: "diagnostic",
      populationSize: all.filter((d) => d.state === "verified" && d.postText).length,
    });
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
    const batchId = await insertBatch(sql, placed, seed, {
      inSeed: false,
      purpose: "diagnostic",
      populationSize: all.filter((d) => d.state === "verified" && d.postText).length,
    });
    return { batchId, size: placed.length };
  });
}

interface DesignRow {
  id: string;
  sampling_design: FormalDesign;
}

/** The most recent formal design, with the rows its status is computed from. */
async function latestFormalDesign(sql: Sql): Promise<DesignRow | undefined> {
  const [design] = await sql<DesignRow[]>`select id, sampling_design from audit_batches
    where purpose = 'formal_eval' order by drawn_at desc limit 1`;
  return design;
}

/**
 * The formal evaluation: one probability sample of the verified claims with a post, drawn once
 * and frozen. Every claim of the catalogue's verified set can be drawn, including the ones the
 * earlier non-probability draws already showed (their old answers are not reused: the claim is
 * answered again, as a sample unit). A new formal design is refused while the last one still
 * waits for answers, because a second one would be a second look at the same question.
 */
export async function drawFormalEvaluation(): Promise<{ batchId: string; size: number }> {
  const all = await drawable();
  const byId = new Map(all.map((d) => [d.claimId, d]));
  return await underDrawLock(async (sql) => {
    const open = await latestFormalDesign(sql);
    if (open) {
      const status = await formalStatusFor(sql, open);
      if (status.decision === "continue")
        throw new Error("The formal evaluation is still waiting for answers.");
    }
    // In a fixed order: the draw repeats from its seed only if the pool it draws from does.
    const candidates = all
      .filter((d) => d.state === "verified" && d.postText)
      .sort((a, b) => a.claimId.localeCompare(b.claimId));
    const seed = newSeed();
    const { design, units } = drawFormalSample(candidates, seed);
    if (!units.length) throw new Error("There are no verified claims with a post to sample yet.");
    // The frame the sample was drawn from, so the draw can be checked against it later: the same
    // seed over another list of eligible claims would give another sample.
    const frozenDesign = {
      ...design,
      eligibilityCutoff: new Date().toISOString(),
      populationFrameHash: sha256(
        candidates.map((c) => `${c.claimId}|${formalStratum(c.language)}`).join("\n"),
      ),
    };
    const [created] = await sql<{ id: string }[]>`
      insert into audit_batches (purpose, sampling_design, population_size, sample_size, seed)
      values ('formal_eval', ${sql.json(frozenDesign as unknown as Record<string, never>)},
              ${Object.values(design.populations).reduce((s, n) => s + n, 0)},
              ${units.length}, ${seed})
      returning id`;
    const auditBatchId = created!.id;
    const unitRows = await sql<{ id: string; claim_id: string }[]>`
      insert into audit_sample_units ${sql(
        units.map((u) => ({
          audit_batch_id: auditBatchId,
          claim_id: u.claimId,
          stratum: u.stratum,
          inclusion_probability: u.inclusionProbability,
        })),
      )} returning id, claim_id`;
    const unitIds = new Map(unitRows.map((r) => [r.claim_id, r.id]));
    const taken = new Set(units.map((u) => u.claimId));
    const random = seededRandom(seed);
    const sampled = units
      .map((u) => ({ item: byId.get(u.claimId)!, k: random() }))
      .sort((a, b) => a.k - b.k)
      .map(({ item }): Placed => ({ item, role: "audit" }));
    const mix = controlMix(sampled.length);
    const altered = drawAuditSample(
      all.filter((d) => d.altered),
      mix.altered,
      seed + 1,
      taken,
    ).map((c) => byId.get(c.claimId)!);
    const misread = drawAuditSample(
      all.filter((d) => d.state === "rejected" && d.identityFailed && d.postText),
      mix.misread,
      seed + 2,
      new Set([...taken, ...altered.map((d) => d.claimId)]),
    ).map((c) => byId.get(c.claimId)!);
    const placed = withControls(sampled, altered, misread, seed);
    const batchId = await insertBatch(sql, placed, seed, {
      inSeed: false,
      purpose: "formal_eval",
      populationSize: candidates.length,
      auditBatchId,
      units: unitIds,
    });
    return { batchId, size: placed.length };
  });
}

/**
 * Ask again about sample units whose every answer was voided by a failed control next to it. The
 * unit is the same one: the new presentation is copied from what the person was shown before (the
 * claim may have changed or left the catalogue since), so the sample is never redrawn and never
 * grows. Returns null when nothing is waiting.
 */
export async function redrawVoided(): Promise<{ batchId: string; size: number } | null> {
  return await underDrawLock(async (sql) => {
    const design = await latestFormalDesign(sql);
    if (!design) return null;
    const rows = await sql<(AuditRow & { sample_unit_id: string | null })[]>`
      select id, batch_id, position, role, in_seed, drone_id, drone_name, spec_label, claim_id,
             language, family, value, evidence, source, source_id, answer, obviously_wrong,
             read_via, drawn_at, control_kind, control_disputed_at, sample_unit_id
        from verification_audit where audit_batch_id = ${design.id}`;
    const voided = voidedByControls(rows);
    const waiting: AuditRow[] = [];
    const byUnit = new Map<string, AuditRow[]>();
    for (const r of rows)
      if (r.role === "audit" && r.sample_unit_id)
        byUnit.set(r.sample_unit_id, [...(byUnit.get(r.sample_unit_id) ?? []), r]);
    for (const presentations of byUnit.values()) {
      const latest = [...presentations].sort(drawOrder).at(-1)!;
      const settled = presentations.some((p) => p.answer && !voided.has(p.id));
      const open = presentations.some((p) => !p.answer);
      if (!settled && !open) waiting.push(latest);
    }
    if (!waiting.length) return null;
    const seed = newSeed();
    const batchId = newBatchId(seed, "audit-retry");
    const ids = waiting.map((r) => r.id);
    await sql`insert into verification_audit
        (batch_id, position, draw_seed, role, in_seed, drone_id, drone_name, spec_key, spec_label,
         claim_id, language, family, state_at_draw, verifier_version, value, evidence, source,
         source_id, post_text, audit_batch_id, sampling_purpose, sample_unit_id, retry_of_audit_id,
         claim_fingerprint, source_text_hash, reader_state_at_draw)
      select ${batchId}, row_number() over (order by a.id) - 1, ${seed}, 'audit', false, a.drone_id,
             a.drone_name, a.spec_key, a.spec_label, a.claim_id, a.language, a.family,
             a.state_at_draw, a.verifier_version, a.value, a.evidence, a.source, a.source_id,
             a.post_text, a.audit_batch_id, 'formal_eval', a.sample_unit_id, a.id,
             a.claim_fingerprint, a.source_text_hash, a.reader_state_at_draw
        from verification_audit a where a.id = any(${ids})`;
    return { batchId, size: waiting.length };
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

interface ReaderReading {
  verdict: StoredEntailmentVerdict;
  evaluated_at: Date | string;
  before_human_answer: boolean | null;
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

const drawOrder = (a: AuditRow, b: AuditRow) =>
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

interface ReaderRecord {
  audit_id: string;
  phase: "at_draw" | "after_draw" | "backfill";
  verdict: StoredEntailmentVerdict | "legacy_unsupported";
  independence: "checked" | "unknown" | null;
  evaluated_at: Date;
  before_human_answer: boolean | null;
  span: string | null;
  note: string | null;
}

const storedVerdict = (v: ReaderRecord["verdict"]): StoredEntailmentVerdict =>
  v === "legacy_unsupported" ? "unsupported" : v;

async function readerRecords(sql: Sql, auditIds: readonly string[]): Promise<ReaderRecord[]> {
  if (!auditIds.length) return [];
  return await sql<ReaderRecord[]>`select audit_id, phase, verdict, independence, evaluated_at,
      before_human_answer, span, note
    from verification_audit_reader where audit_id = any(${auditIds}) order by evaluated_at`;
}

/**
 * Put each row's frozen readings on it. A re-asked sample unit has no reading of its own at draw:
 * it takes the one its first presentation was drawn with, which is the reading the unit had when
 * it was sampled.
 */
async function attachReaders(sql: Sql, rows: AuditRow[]): Promise<void> {
  const records = await readerRecords(
    sql,
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

/** Progress of one formal design, read from its own rows. */
async function formalStatusFor(sql: Sql, design: DesignRow) {
  const rows = await sql<AuditRow[]>`select a.id, a.batch_id, a.position, a.role, a.language,
      a.answer, a.drawn_at, a.control_kind, a.control_disputed_at, a.audit_batch_id,
      a.sample_unit_id, u.stratum as unit_stratum
    from verification_audit a left join audit_sample_units u on u.id = a.sample_unit_id
    where a.audit_batch_id = ${design.id}`;
  return formalStatus(
    { id: design.id, design: design.sampling_design },
    rows,
    voidedByControls(rows),
  );
}

/**
 * The audit's state. Read after every answer, so it stays small: no post text except the next
 * claim's, and the count of claims never drawn - a scan of the catalogue - only when asked for.
 */
export async function auditStatus(opts: { countUndrawn?: boolean } = {}): Promise<AuditStatus> {
  if (!dbConfigured()) return EMPTY;
  const sql = db();
  const rows = await sql<AuditRow[]>`select a.id, a.batch_id, a.position, a.role, a.in_seed,
      a.drone_id, a.drone_name, a.spec_label, a.claim_id, a.language, a.family, a.value, a.evidence,
      a.source, a.source_id, a.answer, a.obviously_wrong, a.read_via, a.drawn_at, a.control_kind,
      a.control_disputed_at, a.audit_batch_id, a.sampling_purpose, a.sample_unit_id,
      u.stratum as unit_stratum
    from verification_audit a left join audit_sample_units u on u.id = a.sample_unit_id`;
  // The reader's verdicts come from what was frozen when each claim was drawn and appended since
  // (verification_audit_reader), never from the catalogue as it is now.
  await attachReaders(sql, rows);
  const design = await latestFormalDesign(sql);
  const status = summarizeAudit(
    rows,
    opts.countUndrawn ? await countUndrawn() : undefined,
    design ? { id: design.id, design: design.sampling_design } : undefined,
  );
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
      read_via, drawn_at, control_kind, control_disputed_at, second_look, sample_unit_id
    from verification_audit where answer is not null`;
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
  const siblings = units.length
    ? await sql<{ id: string; sample_unit_id: string }[]>`select id, sample_unit_id
        from verification_audit where sample_unit_id = any(${units})`
    : [];
  const records = await readerRecords(sql, [
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
