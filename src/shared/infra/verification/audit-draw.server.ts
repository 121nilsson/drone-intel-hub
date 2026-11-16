import {
  AUDIT_BATCH,
  AUDIT_FIRST_DRAW,
  CONTROL_EVERY,
  alteredReading,
  attributeFamily,
  voidedByControls,
  controlMix,
  drawAuditSample,
  insertControls,
  seededRandom,
  textLanguage,
  type AuditCandidate,
  type ControlKind,
} from "@/entities/drone/audit";
import { randomInt } from "node:crypto";
import { drawFormalSample, formalStratum } from "@/entities/drone/audit-design";
import { figuresIn } from "@/entities/drone/value-in-quote";
import { ANALYST_SOURCE } from "@/entities/drone/claim-review";
import { claimReading } from "@/entities/drone/claim-reading";
import { attributeSemantic } from "@/entities/drone/spec-engine";
import type { ClaimEntailment, Drone, SpecAttribute, SpecClaim } from "@/entities/drone/types";
import type {
  AuditDrawTx,
  AuditInsertRow,
  AuditRow,
  DesignRow,
  ReaderRow,
  ReaderStateAtDraw,
} from "@/shared/contracts/audit-repo";
import { serverServices } from "@/shared/infra/server-services.server";
import { formalStatus, drawOrder } from "./audit-analysis.server";
import { claimFingerprint, readerRow, readerStateAtDraw, sha256 } from "./audit-freeze.server";
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
  const audit = serverServices().audit;
  const drones = await audit.allDrones();
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
    ids.length ? (await audit.claimPostTexts(ids)).map((r) => [r.id, r.text ?? ""]) : [],
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
  tx: AuditDrawTx,
  placed: Placed[],
  seed: number,
  opts: BatchOptions,
): Promise<string> {
  const batchId = newBatchId(seed);
  const auditBatchId =
    opts.auditBatchId ??
    (await tx.insertDiagnosticDesign({
      purpose: opts.purpose,
      samplingDesign: { draw: "round_robin", batchId },
      populationSize: opts.populationSize,
      sampleSize: placed.length,
      seed,
    }));
  const frozen = placed.map(({ item }) => {
    const postText = item.postText ?? "";
    const fingerprint = claimFingerprint(item.drone, item.spec, item.claim, postText);
    return {
      fingerprint,
      state: readerStateAtDraw(item.claim, postText, fingerprint) as ReaderStateAtDraw,
    };
  });
  const rows = placed.map(({ item, role, controlKind }, position): AuditInsertRow => ({
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
  const inserted = await tx.insertAuditRows(rows);
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
  await tx.appendReaderRows(readerRows);
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
async function underDrawLock<T>(draw: (tx: AuditDrawTx) => Promise<T>): Promise<T> {
  return await serverServices().audit.drawTransaction(draw);
}

async function auditedClaimIds(tx: AuditDrawTx): Promise<Set<string>> {
  return new Set(await tx.auditedClaimIds());
}

/**
 * The first session: the first audit draw, which is also the verified part of the seed set, plus
 * the seed set's rejected and uncertain claims, all shuffled together so the auditor cannot tell
 * which is which, with hidden controls. Drawn once; the seed set it creates is frozen.
 */
export async function drawFirstSession(): Promise<{ batchId: string; size: number }> {
  const all = await drawable();
  return await underDrawLock(async (tx) => {
    if ((await tx.seedSetSize()) > 0)
      throw new Error("The first session has already been drawn; the seed set is frozen.");
    const seed = newSeed();
    const random = seededRandom(seed);
    const pick = (pool: Drawable[], size: number, exclude: ReadonlySet<string>, offset: number) => {
      const byId = new Map(pool.map((d) => [d.claimId, d]));
      return drawAuditSample(pool, size, seed + offset, exclude).map((c) => byId.get(c.claimId)!);
    };
    const audited = await auditedClaimIds(tx);
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
    const batchId = await insertBatch(tx, placed, seed, {
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
  return await underDrawLock(async (tx) => {
    const audited = await auditedClaimIds(tx);
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
    const batchId = await insertBatch(tx, placed, seed, {
      inSeed: false,
      purpose: "diagnostic",
      populationSize: all.filter((d) => d.state === "verified" && d.postText).length,
    });
    return { batchId, size: placed.length };
  });
}

/** Progress of one formal design, read from its own rows. */
async function formalStatusFor(tx: AuditDrawTx, design: DesignRow) {
  const rows = await tx.formalDesignRows(design.id);
  return formalStatus(
    { id: design.id, design: design.sampling_design },
    rows,
    voidedByControls(rows),
  );
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
  return await underDrawLock(async (tx) => {
    const open = await tx.latestFormalDesign();
    if (open) {
      const status = await formalStatusFor(tx, open);
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
    const auditBatchId = await tx.insertFormalDesign({
      samplingDesign: frozenDesign,
      populationSize: Object.values(design.populations).reduce((s, n) => s + n, 0),
      sampleSize: units.length,
      seed,
    });
    const unitRows = await tx.insertSampleUnits(
      units.map((u) => ({
        audit_batch_id: auditBatchId,
        claim_id: u.claimId,
        stratum: u.stratum,
        inclusion_probability: u.inclusionProbability,
      })),
    );
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
    const batchId = await insertBatch(tx, placed, seed, {
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
  return await underDrawLock(async (tx) => {
    const design = await tx.latestFormalDesign();
    if (!design) return null;
    const rows = await tx.retryCandidates(design.id);
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
    await tx.insertRetryRows({ batchId, seed, ids });
    return { batchId, size: waiting.length };
  });
}
