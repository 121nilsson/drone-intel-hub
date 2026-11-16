/**
 * Phase 3.2 / S1 + S4 — CSV export/import for the two-step review.
 *
 * The blind schema deliberately has NO resolver or AI columns: the first judgement must be
 * independent. The reveal schema adds them plus a blank `final_verdict` (blank = keep the blind
 * verdict). Import rejects a blind sheet that carries AI/resolver columns, incomplete rows, and
 * mixed protocol versions unless explicitly allowed.
 */

import { isValidCanonicalId } from "../canonical-manifest";
import {
  EVAL_PROTOCOL_VERSION,
  PROTOCOL_VERSIONS,
  VERDICTS,
  type Decision,
  type EvalProtocolVersion,
  type Example,
  type Prediction,
  type Suggestion,
  type Verdict,
} from "./types";
import { ValidationError } from "./validate";

export const BLIND_COLUMNS = [
  "example_id",
  "protocol_version",
  "source_id",
  "source_url",
  "source_published_at",
  "language",
  "family",
  "excerpt",
  "raw_key",
  "raw_label",
  "raw_value",
  "raw_unit",
  "context_domain",
  "context_system_class",
  "context_subsystem",
  "verdict",
  "canonical_id",
  "note",
] as const;

export const REVEAL_ONLY_COLUMNS = [
  "resolver_status",
  "resolver_canonical_id",
  "resolver_candidates",
  "ai_verdict",
  "ai_canonical_id",
  "ai_rationale",
  "ai_missing_info",
  "final_verdict",
  "final_canonical_id",
  "revision_reason",
] as const;

export const REVEAL_COLUMNS = [...BLIND_COLUMNS, ...REVEAL_ONLY_COLUMNS] as const;

export type ReviewStep = "blind" | "reveal";

export function columnsFor(step: ReviewStep): readonly string[] {
  return step === "blind" ? BLIND_COLUMNS : REVEAL_COLUMNS;
}

// ─── RFC4180 codec ─────────────────────────────────────────────────────────

function encodeCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function encodeCsv(rows: readonly (readonly string[])[]): string {
  return `${rows.map((row) => row.map(encodeCell).join(",")).join("\n")}\n`;
}

/** Parses quotes, doubled quotes and embedded newlines. Rejects ragged rows at the caller. */
export function decodeCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell.length === 0) {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      // CRLF: the following \n closes the row; a bare \r is just part of the cell.
      if (input[i + 1] === "\n") continue;
      cell += ch;
    } else cell += ch;
  }
  if (quoted) throw new ValidationError("CSV: unterminated quoted cell");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Alias used by callers that think in parsed tables rather than decoded CSV cells. */
export const parseCsv = decodeCsv;

function tableFrom(csv: string, expectedHeader: readonly string[]): Map<string, string>[] {
  const rows = decodeCsv(csv);
  if (rows.length === 0) throw new ValidationError("CSV: empty file");
  const header = rows[0]!;
  if (header.join("|") !== expectedHeader.join("|")) {
    throw new ValidationError(
      `CSV header mismatch: expected ${expectedHeader.join(",")} but got ${header.join(",")}`,
    );
  }
  return rows.slice(1).map((cells, i) => {
    if (cells.length !== header.length) {
      throw new ValidationError(
        `CSV row ${i + 2}: ${cells.length} cells, expected ${header.length}`,
      );
    }
    const obj = new Map<string, string>();
    header.forEach((h, j) => obj.set(h, cells[j]!));
    return obj;
  });
}

const get = (row: Map<string, string>, key: string): string => row.get(key) ?? "";

// ─── Export ────────────────────────────────────────────────────────────────

function exampleRow(
  e: Example,
  d: Decision | undefined,
  step: ReviewStep,
  protocolVersion: EvalProtocolVersion = EVAL_PROTOCOL_VERSION,
): string[] {
  const base = [
    e.exampleId,
    protocolVersion,
    e.source.id,
    e.source.url ?? "",
    e.source.publishedAt ?? "",
    e.language,
    e.family,
    e.excerpt,
    e.rawKey,
    e.rawLabel ?? "",
    e.rawValue ?? "",
    e.rawUnit ?? "",
    e.context.domain ?? "",
    e.context.systemClass ?? "",
    e.context.subsystem ?? "",
    d?.blindVerdict ?? "",
    d?.blindCanonicalId ?? "",
    d?.blindNote ?? "",
  ];
  if (step === "blind") return base;
  return [
    ...base,
    e.resolverStatus,
    "", // resolver_canonical_id / candidates are injected by revealCsv
    "",
    "",
    "",
    "",
    "",
    d?.finalVerdict === d?.blindVerdict ? "" : (d?.finalVerdict ?? ""),
    d?.finalCanonicalId === d?.blindCanonicalId ? "" : (d?.finalCanonicalId ?? ""),
    d?.revisionReason ?? "",
  ];
}

/** Blank blind queue: one row per example, no resolver/AI information anywhere. */
export function exportBlindCsv(
  examples: readonly Example[],
  existing: readonly Decision[] = [],
): string {
  const byId = new Map(existing.map((d) => [d.exampleId, d]));
  return encodeCsv([
    [...BLIND_COLUMNS],
    ...examples.map((e) => exampleRow(e, byId.get(e.exampleId), "blind")),
  ]);
}

export interface RevealCsvInput {
  readonly examples: readonly Example[];
  readonly predictions: readonly Prediction[];
  readonly suggestions: readonly Suggestion[];
  readonly existing?: readonly Decision[];
}

/** Reveal queue: adds resolver/AI columns and a blank final_verdict (blank = keep blind). */
export function exportRevealCsv(input: RevealCsvInput): string {
  const pred = new Map(input.predictions.map((p) => [p.exampleId, p]));
  const sugg = new Map(input.suggestions.map((s) => [s.exampleId, s]));
  const dec = new Map((input.existing ?? []).map((d) => [d.exampleId, d]));
  const rows = input.examples.map((e) => {
    const row = exampleRow(e, dec.get(e.exampleId), "reveal");
    const p = pred.get(e.exampleId);
    const s = sugg.get(e.exampleId);
    const at = (name: string): number =>
      REVEAL_COLUMNS.indexOf(name as (typeof REVEAL_COLUMNS)[number]);
    row[at("resolver_status")] = p?.result.status ?? "";
    row[at("resolver_canonical_id")] = p?.result.canonicalId ?? "";
    row[at("resolver_candidates")] = (p?.result.candidateCanonicalIds ?? []).join(";");
    row[at("ai_verdict")] = s?.proposed.verdict ?? "";
    row[at("ai_canonical_id")] = s?.proposed.canonicalId ?? "";
    row[at("ai_rationale")] = s?.rationale ?? "";
    row[at("ai_missing_info")] = (s?.missingInfo ?? []).join(";");
    return row;
  });
  return encodeCsv([[...REVEAL_COLUMNS], ...rows]);
}

/** Full round-trip export used by tests and by a maintainer re-checking their decisions. */
export function exportDecisionsCsv(
  decisions: readonly Decision[],
  examples: readonly Example[],
  step: ReviewStep,
): string {
  const byId = new Map(examples.map((e) => [e.exampleId, e]));
  const rows = decisions.flatMap((d) => {
    const e = byId.get(d.exampleId);
    return e === undefined ? [] : [exampleRow(e, d, step, d.protocolVersion)];
  });
  return encodeCsv([[...(step === "blind" ? BLIND_COLUMNS : REVEAL_COLUMNS)], ...rows]);
}

// ─── Import ────────────────────────────────────────────────────────────────

export interface ImportOptions {
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly allowMixedProtocol?: boolean;
  readonly step?: ReviewStep;
}

export interface ImportResult {
  readonly decisions: Decision[];
  readonly step: ReviewStep;
  readonly protocolVersions: readonly string[];
}

function readVerdict(
  row: Map<string, string>,
  key: string,
  required: boolean,
): Verdict | undefined {
  const raw = get(row, key).trim();
  if (raw.length === 0) {
    if (required) throw new ValidationError(`CSV row: ${key} is required`);
    return undefined;
  }
  if (!VERDICTS.includes(raw as Verdict)) {
    throw new ValidationError(`CSV row: invalid ${key}: ${raw}`);
  }
  return raw as Verdict;
}

function readCanonical(
  row: Map<string, string>,
  key: string,
  v: Verdict | undefined,
): string | undefined {
  const raw = get(row, key).trim();
  if (v === "resolve") {
    if (raw.length === 0) throw new ValidationError(`CSV row: ${key} required for verdict resolve`);
    if (!isValidCanonicalId(raw)) throw new ValidationError(`CSV row: invalid ${key}: ${raw}`);
    return raw;
  }
  if (raw.length > 0) throw new ValidationError(`CSV row: ${key} not allowed for verdict ${v}`);
  return undefined;
}

function readProtocol(row: Map<string, string>): EvalProtocolVersion {
  const raw = get(row, "protocol_version").trim();
  if (!PROTOCOL_VERSIONS.includes(raw as EvalProtocolVersion)) {
    throw new ValidationError(`CSV row: invalid protocol_version: ${raw}`);
  }
  return raw as EvalProtocolVersion;
}

/** Import a blind or reveal CSV into Decisions. Rejects incomplete, invalid and mixed rows. */
export function importCsv(csv: string, options: ImportOptions): ImportResult {
  const header = decodeCsv(csv)[0] ?? [];
  const hasReveal = REVEAL_ONLY_COLUMNS.some((c) => header.includes(c));
  const step: ReviewStep = options.step ?? (hasReveal ? "reveal" : "blind");
  const expected = columnsFor(step);
  if (header.join("|") !== expected.join("|")) {
    if (!hasReveal && step === "reveal") {
      throw new ValidationError("reveal import needs the reveal schema");
    }
    throw new ValidationError(
      hasReveal
        ? "blind import refuses a CSV with AI/resolver columns or an incomplete reveal schema"
        : `CSV header mismatch: expected ${expected.join(",")} but got ${header.join(",")}`,
    );
  }
  const rows = tableFrom(csv, expected);
  if (options.reviewer.trim().length === 0) throw new ValidationError("reviewer is required");
  const decisions: Decision[] = [];
  const versions = new Set<string>();
  rows.forEach((row, i) => {
    try {
      const exampleId = get(row, "example_id").trim();
      if (!/^[0-9a-f]{64}$/.test(exampleId)) throw new ValidationError("invalid example_id");
      const blindVerdict = readVerdict(row, "verdict", true)!;
      const blindCanonicalId = readCanonical(row, "canonical_id", blindVerdict);
      const protocolVersion = readProtocol(row);
      versions.add(protocolVersion);
      let finalVerdict = blindVerdict;
      let finalCanonicalId = blindCanonicalId;
      let revisionReason: string | undefined;
      if (step === "reveal") {
        const typedFinal = readVerdict(row, "final_verdict", false);
        if (typedFinal !== undefined) {
          finalVerdict = typedFinal;
          finalCanonicalId = readCanonical(row, "final_canonical_id", typedFinal);
        }
        const reason = get(row, "revision_reason").trim();
        const revised = finalVerdict !== blindVerdict || finalCanonicalId !== blindCanonicalId;
        if (revised && reason.length === 0) {
          throw new ValidationError("revision_reason is required when the verdict changed");
        }
        if (revised) revisionReason = reason;
      }
      const revisedAfterReveal =
        finalVerdict !== blindVerdict || finalCanonicalId !== blindCanonicalId;
      decisions.push({
        exampleId,
        blindVerdict,
        ...(blindCanonicalId !== undefined ? { blindCanonicalId } : {}),
        blindNote: get(row, "note"),
        finalVerdict,
        ...(finalCanonicalId !== undefined ? { finalCanonicalId } : {}),
        revisedAfterReveal,
        ...(revisionReason !== undefined ? { revisionReason } : {}),
        reviewer: options.reviewer,
        reviewedAt: options.reviewedAt,
        protocolVersion,
        status: "human_reviewed",
      });
    } catch (e) {
      const msg = e instanceof ValidationError ? e.message : (e as Error).message;
      throw new ValidationError(`CSV row ${i + 2}: ${msg}`);
    }
  });
  if (versions.size > 1 && options.allowMixedProtocol !== true) {
    throw new ValidationError(
      `CSV mixes protocol versions (${[...versions].sort().join(", ")}); pass --allow-mixed-protocol to include them separately`,
    );
  }
  return { decisions, step, protocolVersions: [...versions].sort() };
}
