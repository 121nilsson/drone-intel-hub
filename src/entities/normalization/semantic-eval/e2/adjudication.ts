/**
 * E2 pipeline, step c: blind human language adjudication of the drawn sample. Pure: no resolver,
 * no snapshot, no detector, no file access. Nothing outside semantic-eval imports this directory.
 *
 * What the blind reviewer gets (`buildE2AdjudicationExport`): an opaque example id and the stored
 * excerpt, nothing else. Not the routing stratum, not the declared language, no detection, no
 * source, no raw key, family or origin. Rows are ordered by exampleId, a SHA-256 hash, so the order
 * carries no information about the stratum or the draw.
 *
 * Why there is no cluster dedupe here: step b collapses each evidence cluster to one row before the
 * draw, so the sample holds at most one example per evidence cluster and two adjudications of the
 * same evidence can never conflict. `assertSampleIsAdjudicable` checks that invariant instead of
 * silently relying on it.
 */

import { sha256Hex } from "../../sha256";
import { ValidationError, toJsonl } from "../validate";
import { decodeCsv, encodeCsv } from "../csv";
import { e2RowsJsonl } from "./population";
import {
  ADJUDICATED_LANGUAGES,
  E2_ADJUDICATION_PROTOCOL_VERSION,
  E2_SCHEMA_VERSION,
  type AdjudicatedLanguage,
  type E2Adjudication,
  type E2AdjudicationManifest,
  type E2Example,
  type E2IdenticalExcerptConflict,
  type E2PopulationManifest,
  type E2SampleManifest,
} from "./types";
import {
  checkE2HashChain,
  e2ManifestHash,
  validateE2Adjudication,
  validateE2AdjudicationManifest,
} from "./validate";

/** Blind export header. The reviewer fills `language`. */
export const E2_BLIND_EXPORT_COLUMNS = ["example_id", "excerpt", "language"] as const;
/** Resolution CSV header (a JSONL resolution file uses the camelCase field names). */
export const E2_RESOLUTION_COLUMNS = [
  "example_id",
  "final_language",
  "resolved_by",
  "note",
] as const;

export interface E2ReviewerEntry {
  readonly exampleId: string;
  readonly language: AdjudicatedLanguage;
}

export interface E2Resolution {
  readonly exampleId: string;
  readonly finalAdjudicatedLanguage: AdjudicatedLanguage;
  readonly resolvedBy: string;
  readonly note?: string | undefined;
}

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function refuse(message: string): never {
  throw new ValidationError(message);
}

function isAdjudicatedLanguage(x: string): x is AdjudicatedLanguage {
  return (ADJUDICATED_LANGUAGES as readonly string[]).includes(x);
}

function languageValue(where: string, raw: string): AdjudicatedLanguage {
  const v = raw.trim();
  if (!isAdjudicatedLanguage(v)) {
    refuse(
      `${where}: invalid language ${JSON.stringify(raw)}; allowed: ${ADJUDICATED_LANGUAGES.join(", ")}`,
    );
  }
  return v;
}

/** The invariant that makes a separate adjudication cluster dedupe unnecessary (see file header). */
export function assertSampleIsAdjudicable(rows: readonly E2Example[]): void {
  const ids = new Set<string>();
  const clusters = new Map<string, string>();
  for (const e of rows) {
    if (ids.has(e.exampleId)) refuse(`sample: duplicate exampleId ${e.exampleId}`);
    ids.add(e.exampleId);
    const prior = clusters.get(e.evidenceClusterId);
    if (prior !== undefined) {
      refuse(
        `sample: examples ${prior} and ${e.exampleId} share evidenceClusterId ${e.evidenceClusterId}; the draw must hold one example per evidence cluster`,
      );
    }
    clusters.set(e.evidenceClusterId, e.exampleId);
  }
}

/** The blind CSV: exampleId and stored excerpt only, rows sorted by exampleId (a hash). */
export function buildE2AdjudicationExport(rows: readonly E2Example[]): string {
  assertSampleIsAdjudicable(rows);
  const sorted = [...rows].sort((a, b) => byCodeUnits(a.exampleId, b.exampleId));
  return encodeCsv([
    [...E2_BLIND_EXPORT_COLUMNS],
    ...sorted.map((e) => [e.exampleId, e.excerpt, ""]),
  ]);
}

function table(text: string, header: readonly string[], required: readonly string[], what: string) {
  const rows = decodeCsv(text);
  if (rows.length === 0) refuse(`${what}: empty file`);
  const head = rows[0]!.map((c) => c.trim());
  for (const col of required) {
    if (!head.includes(col)) refuse(`${what}: missing column ${col}; expected ${header.join(",")}`);
  }
  for (const col of head) {
    if (!header.includes(col)) refuse(`${what}: unexpected column ${JSON.stringify(col)}`);
  }
  if (new Set(head).size !== head.length) refuse(`${what}: duplicate column`);
  const body = rows.slice(1).filter((r) => !(r.length === 1 && r[0]!.trim() === ""));
  return body.map((r, i) => {
    if (r.length !== head.length)
      refuse(`${what}: row ${i + 2} has ${r.length} cells, expected ${head.length}`);
    const m = new Map<string, string>();
    head.forEach((c, j) => m.set(c, r[j]!));
    return { line: i + 2, cells: m };
  });
}

/** Parses a reviewer's filled-in export. Refuses an invalid value or a duplicate id. */
export function parseReviewerCsv(text: string, what = "reviewer file"): E2ReviewerEntry[] {
  const rows = table(text, E2_BLIND_EXPORT_COLUMNS, ["example_id", "language"], what);
  const seen = new Set<string>();
  return rows.map(({ line, cells }) => {
    const exampleId = cells.get("example_id")!.trim();
    if (exampleId.length === 0) refuse(`${what}: row ${line} has no example_id`);
    if (seen.has(exampleId)) refuse(`${what}: duplicate example_id ${exampleId}`);
    seen.add(exampleId);
    return {
      exampleId,
      language: languageValue(`${what} row ${line} (${exampleId})`, cells.get("language")!),
    };
  });
}

/** Parses a resolution file: CSV (`.csv`) or JSONL, one object per line. */
export function parseResolutions(
  text: string,
  format: "csv" | "jsonl",
  what = "resolutions",
): E2Resolution[] {
  const out: E2Resolution[] = [];
  if (format === "csv") {
    const rows = table(
      text,
      E2_RESOLUTION_COLUMNS,
      ["example_id", "final_language", "resolved_by"],
      what,
    );
    for (const { line, cells } of rows) {
      const note = cells.get("note")?.trim();
      out.push({
        exampleId: cells.get("example_id")!.trim(),
        finalAdjudicatedLanguage: languageValue(
          `${what} row ${line}`,
          cells.get("final_language")!,
        ),
        resolvedBy: cells.get("resolved_by")!.trim(),
        ...(note ? { note } : {}),
      });
    }
  } else {
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .forEach((l, i) => {
        let o: unknown;
        try {
          o = JSON.parse(l);
        } catch {
          refuse(`${what}: line ${i + 1} is not JSON`);
        }
        if (typeof o !== "object" || o === null || Array.isArray(o))
          refuse(`${what}: line ${i + 1} is not an object`);
        const r = o as Record<string, unknown>;
        for (const k of Object.keys(r)) {
          if (!["exampleId", "finalAdjudicatedLanguage", "resolvedBy", "note"].includes(k)) {
            refuse(`${what}: line ${i + 1} has unknown key ${JSON.stringify(k)}`);
          }
        }
        if (
          typeof r["exampleId"] !== "string" ||
          typeof r["finalAdjudicatedLanguage"] !== "string" ||
          typeof r["resolvedBy"] !== "string"
        ) {
          refuse(
            `${what}: line ${i + 1} needs string exampleId, finalAdjudicatedLanguage and resolvedBy`,
          );
        }
        const note =
          typeof r["note"] === "string" && r["note"].trim() ? r["note"].trim() : undefined;
        out.push({
          exampleId: r["exampleId"].trim(),
          finalAdjudicatedLanguage: languageValue(
            `${what} line ${i + 1}`,
            r["finalAdjudicatedLanguage"],
          ),
          resolvedBy: r["resolvedBy"].trim(),
          ...(note ? { note } : {}),
        });
      });
  }
  const seen = new Set<string>();
  for (const r of out) {
    if (r.resolvedBy.length === 0)
      refuse(`${what}: resolution for ${r.exampleId} has an empty resolvedBy`);
    if (seen.has(r.exampleId)) refuse(`${what}: duplicate resolution for ${r.exampleId}`);
    seen.add(r.exampleId);
  }
  return out;
}

export interface E2ReviewerInput {
  readonly reviewerId: string;
  readonly entries: readonly E2ReviewerEntry[];
}

export interface E2AdjudicationInput {
  readonly sampleRows: readonly E2Example[];
  readonly sampleManifest: E2SampleManifest;
  readonly populationManifest: E2PopulationManifest;
  readonly first: E2ReviewerInput;
  readonly second?: E2ReviewerInput | undefined;
  readonly resolutions?: readonly E2Resolution[] | undefined;
  /** Injected for tests; defaults to the current instant. */
  readonly frozenAt?: string | undefined;
}

export interface E2AdjudicationFreeze {
  /** Sorted by exampleId. */
  readonly rows: readonly E2Adjudication[];
  readonly jsonl: string;
  readonly manifest: E2AdjudicationManifest;
}

/** Canonical adjudications file: one canonical JSON object per line, sorted by exampleId. */
export function e2AdjudicationsJsonl(rows: readonly E2Adjudication[]): string {
  return toJsonl([...rows].sort((a, b) => byCodeUnits(a.exampleId, b.exampleId)));
}

function idSet(entries: readonly E2ReviewerEntry[]): Set<string> {
  return new Set(entries.map((e) => e.exampleId));
}

function checkAgainstSample(
  who: string,
  ids: ReadonlySet<string>,
  sample: ReadonlySet<string>,
): void {
  const unknown = [...ids].filter((i) => !sample.has(i)).sort(byCodeUnits);
  if (unknown.length > 0)
    refuse(`${who}: ${unknown.length} id(s) not in the drawn sample, first ${unknown[0]}`);
  const missing = [...sample].filter((i) => !ids.has(i)).sort(byCodeUnits);
  if (missing.length > 0)
    refuse(`${who}: ${missing.length} drawn id(s) not adjudicated, first ${missing[0]}`);
}

/**
 * Builds and validates the frozen adjudication stage. Refuses (throws `ValidationError`) on any
 * integrity problem. A disagreement is never resolved by order: it needs an entry in `resolutions`.
 */
export function freezeE2Adjudications(input: E2AdjudicationInput): E2AdjudicationFreeze {
  const { sampleRows, sampleManifest, populationManifest, first, second } = input;
  const resolutions = input.resolutions ?? [];
  assertSampleIsAdjudicable(sampleRows);
  if (sha256Hex(e2RowsJsonl(sampleRows)) !== sampleManifest.drawnRowsSha256) {
    refuse("the sample rows do not match the sample manifest hash");
  }
  const sampleIds = new Set(sampleRows.map((e) => e.exampleId));
  if (
    sampleManifest.drawnExampleIds.length !== sampleIds.size ||
    sampleManifest.drawnExampleIds.some((i) => !sampleIds.has(i))
  ) {
    refuse("the sample rows do not match the sample manifest's drawnExampleIds");
  }
  if (first.reviewerId.trim().length === 0) refuse("the reviewer id is empty");
  if (second !== undefined) {
    if (second.reviewerId.trim().length === 0) refuse("the second reviewer id is empty");
    if (second.reviewerId === first.reviewerId)
      refuse("the second reviewer id must differ from the first");
  }
  if (second === undefined && resolutions.length > 0) {
    refuse(
      "resolutions were given but there is no second reviewer, so there is nothing to resolve",
    );
  }

  const dup = (who: string, entries: readonly E2ReviewerEntry[]) => {
    if (idSet(entries).size !== entries.length) refuse(`${who}: duplicate example id`);
  };
  dup("reviewer", first.entries);
  if (second !== undefined) dup("second reviewer", second.entries);
  const firstIds = idSet(first.entries);
  if (second !== undefined) {
    const secondIds = idSet(second.entries);
    if (firstIds.size !== secondIds.size || [...firstIds].some((i) => !secondIds.has(i))) {
      refuse("the reviewers' example id sets differ: both must adjudicate the same ids");
    }
  }
  checkAgainstSample("reviewer", firstIds, sampleIds);
  if (second !== undefined) checkAgainstSample("second reviewer", idSet(second.entries), sampleIds);

  const secondBy = new Map(second?.entries.map((e) => [e.exampleId, e.language]) ?? []);
  const resBy = new Map(resolutions.map((r) => [r.exampleId, r]));
  if (resBy.size !== resolutions.length) refuse("resolutions: duplicate example id");
  const disagreeing = new Set(
    first.entries
      .filter((e) => secondBy.has(e.exampleId) && secondBy.get(e.exampleId) !== e.language)
      .map((e) => e.exampleId),
  );
  for (const id of resBy.keys()) {
    if (!disagreeing.has(id)) {
      refuse(`resolutions: ${id} is not a disagreement (unknown id or the reviewers agree)`);
    }
  }
  const unresolved = [...disagreeing].filter((i) => !resBy.has(i)).sort(byCodeUnits);
  if (unresolved.length > 0) {
    refuse(
      `${unresolved.length} unresolved disagreement(s), first ${unresolved[0]}: every disagreement needs an explicit resolution`,
    );
  }

  const rows: E2Adjudication[] = first.entries.map((e) => {
    const s = secondBy.get(e.exampleId);
    const res = resBy.get(e.exampleId);
    return validateE2Adjudication({
      exampleId: e.exampleId,
      reviewerId: first.reviewerId,
      protocolVersion: E2_ADJUDICATION_PROTOCOL_VERSION,
      reviewerLanguage: e.language,
      ...(second !== undefined
        ? { secondReviewerId: second.reviewerId, secondReviewerLanguage: s }
        : {}),
      finalAdjudicatedLanguage: res !== undefined ? res.finalAdjudicatedLanguage : e.language,
      disagreement: res !== undefined,
      ...(res !== undefined ? { resolvedBy: res.resolvedBy } : {}),
      ...(res?.note !== undefined ? { note: res.note } : {}),
    });
  });
  rows.sort((a, b) => byCodeUnits(a.exampleId, b.exampleId));
  const finalLanguages = new Map(rows.map((r) => [r.exampleId, r.finalAdjudicatedLanguage]));
  const flags = e2AdjudicationConflictFlags(sampleRows, finalLanguages);
  const jsonl = e2AdjudicationsJsonl(rows);
  const manifest = validateE2AdjudicationManifest({
    stage: "adjudication",
    schemaVersion: E2_SCHEMA_VERSION,
    sampleManifestSha256: e2ManifestHash(sampleManifest),
    adjudicationSha256: sha256Hex(jsonl),
    protocolVersion: E2_ADJUDICATION_PROTOCOL_VERSION,
    reviewerIds: second !== undefined ? [first.reviewerId, second.reviewerId] : [first.reviewerId],
    secondReviewerUsed: second !== undefined,
    disagreementCount: disagreeing.size,
    flaggedDeclaredAdjudicatedConflictCount: flags.declaredAdjudicatedExampleIds.length,
    flaggedDeclaredAdjudicatedExampleIds: flags.declaredAdjudicatedExampleIds,
    flaggedIdenticalExcerptConflictCount: flags.identicalExcerptConflicts.length,
    flaggedIdenticalExcerptConflicts: flags.identicalExcerptConflicts,
    frozenAt: input.frozenAt ?? new Date().toISOString(),
  });
  const chain = checkE2HashChain({
    population: populationManifest,
    sample: sampleManifest,
    adjudication: manifest,
  });
  if (chain.length > 0) refuse(`hash chain: ${chain.join("; ")}`);
  return { rows, jsonl, manifest };
}

/**
 * Conflicts the tool can report but must never settle. Declared language keeps precedence for
 * resolver input, so a declared/adjudicated mismatch is only a flag. Identical excerpts with
 * different final languages are left for explicit review; no sorting or dedupe chooses a winner.
 */
export interface E2AdjudicationConflictFlags {
  readonly declaredAdjudicatedExampleIds: readonly string[];
  readonly identicalExcerptConflicts: readonly E2IdenticalExcerptConflict[];
}

export function e2AdjudicationConflictFlags(
  sampleRows: readonly E2Example[],
  finalLanguages: ReadonlyMap<string, AdjudicatedLanguage>,
): E2AdjudicationConflictFlags {
  const declaredAdjudicatedExampleIds = sampleRows
    .filter((e) => {
      const final = finalLanguages.get(e.exampleId);
      return (
        e.declaredLanguage !== undefined && final !== undefined && final !== e.declaredLanguage
      );
    })
    .map((e) => e.exampleId)
    .sort(byCodeUnits);

  const byExcerpt = new Map<string, string[]>();
  for (const e of sampleRows) {
    const ids = byExcerpt.get(e.excerpt) ?? [];
    ids.push(e.exampleId);
    byExcerpt.set(e.excerpt, ids);
  }
  const identicalExcerptConflicts: E2IdenticalExcerptConflict[] = [];
  for (const [excerpt, ids] of byExcerpt) {
    if (ids.length < 2) continue;
    const languages = new Set(ids.map((id) => finalLanguages.get(id)));
    if (languages.size < 2) continue;
    identicalExcerptConflicts.push({
      excerptSha256: sha256Hex(excerpt),
      exampleIds: [...ids].sort(byCodeUnits),
    });
  }
  identicalExcerptConflicts.sort((a, b) => byCodeUnits(a.excerptSha256, b.excerptSha256));
  return { declaredAdjudicatedExampleIds, identicalExcerptConflicts };
}

/** Pretty manifest text as written to disk. */
export function e2AdjudicationManifestText(m: E2AdjudicationManifest): string {
  return `${JSON.stringify(m, null, 2)}\n`;
}
