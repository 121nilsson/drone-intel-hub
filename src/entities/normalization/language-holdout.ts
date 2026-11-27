/**
 * Guard for the single holdout evaluation of the language detector (review findings R5, Q1, T1,
 * T5, U1, U2, U5).
 *
 * A holdout supports approval of exactly one frozen detector version, once. After that it is
 * consumed: running it again, and above all running it with a newer detector, yields figures that
 * could be cited as approval evidence for a version that was never evaluated on unseen data. The
 * guard refuses such a run before the holdout is loaded, so its texts are never touched.
 *
 * Identity, not configuration, decides what is loaded:
 * - the id has a strict form (`v1`, `v2`, …) and its fixture name is derived from it
 *   (`holdoutFixtureFor`); a registry record that names any other fixture is refused (T5);
 * - the module that is imported is built from `holdoutFixtureFor(id)` itself, never from a value
 *   read back out of the registry (U1), so name and import path cannot drift apart (T1);
 * - the registry is read exactly once per call into a frozen snapshot, and every decision uses
 *   that snapshot (U1, U5); the committed registry is itself deeply frozen;
 * - a fixture that any id has consumed is refused under every id;
 * - an import that fails, or yields no rows, is refused before anything is evaluated (U2).
 */

export interface LanguageHoldoutRecord {
  /** Fixture module name under `src/test/fixtures`; must equal `holdoutFixtureFor(id)`. */
  readonly fixture: string;
  /** The only detector version this holdout may be evaluated with. */
  readonly evaluatedWith: string;
  /** Date of the single evaluation; set once it has run. A consumed holdout never runs again. */
  readonly consumedOn?: string;
}

/** The committed registry. Deeply frozen: it cannot be changed at run time, cast or not (U5). */
export const LANGUAGE_HOLDOUTS: Readonly<Record<string, LanguageHoldoutRecord>> = Object.freeze({
  v1: Object.freeze({
    fixture: "language-detect-holdout",
    evaluatedWith: "3.0.0",
    consumedOn: "2026-11-27",
  }),
  // Package 3: frozen in 27b7542 (module SHA-256 4578cfe7…), V4 accepted; not yet evaluated.
  v2: Object.freeze({
    fixture: "language-detect-holdout-v2",
    evaluatedWith: "3.1.0",
  }),
});

/** `v1`, `v2`, … `v10`: no leading zero, nothing else. */
const HOLDOUT_ID = /^v[1-9][0-9]*$/;

/**
 * The one fixture name a holdout id may use. v1 predates versioned names and keeps its name; every
 * later id is `language-detect-holdout-<id>`. Undefined for an id that is not of the strict form.
 */
export function holdoutFixtureFor(holdoutId: string): string | undefined {
  if (!HOLDOUT_ID.test(holdoutId)) return undefined;
  return holdoutId === "v1" ? "language-detect-holdout" : `language-detect-holdout-${holdoutId}`;
}

/**
 * The module the evaluation script imports for a fixture, relative to `scripts/`. Derived from the
 * fixture name only; the script has no other way to name a holdout module.
 */
export function holdoutModuleSpecifier(fixture: string): string {
  return `../src/test/fixtures/${fixture}.ts`;
}

type Snapshot = ReadonlyMap<string, LanguageHoldoutRecord>;

/** Reads each entry and each field exactly once into frozen plain records. */
function snapshotOf(entries: Iterable<readonly [string, LanguageHoldoutRecord]>): Snapshot {
  const out = new Map<string, LanguageHoldoutRecord>();
  for (const [id, record] of entries) {
    if (typeof id !== "string") continue;
    const fixture = record.fixture;
    const evaluatedWith = record.evaluatedWith;
    const consumedOn = record.consumedOn;
    out.set(
      id,
      Object.freeze({
        fixture: String(fixture),
        evaluatedWith: String(evaluatedWith),
        ...(consumedOn !== undefined ? { consumedOn: String(consumedOn) } : {}),
      }),
    );
  }
  return out;
}

const committedSnapshot = (): Snapshot => snapshotOf(Object.entries(LANGUAGE_HOLDOUTS));

function refusalOn(snapshot: Snapshot, holdoutId: string, detectorVersion: string) {
  const expected = holdoutFixtureFor(holdoutId);
  if (expected === undefined) return `invalid holdout id "${holdoutId}" (expected v1, v2, …)`;
  const h = snapshot.get(holdoutId);
  if (!h) return `unknown holdout "${holdoutId}"`;
  if (h.fixture !== expected) {
    return `holdout ${holdoutId} names fixture "${h.fixture}", but its fixture must be "${expected}"`;
  }
  if (h.consumedOn !== undefined) {
    return `holdout ${holdoutId} was consumed on ${h.consumedOn} by detector ${h.evaluatedWith}; a new run is not approval evidence for any version, including ${detectorVersion}`;
  }
  for (const [otherId, other] of snapshot) {
    if (otherId !== holdoutId && other.fixture === expected) {
      return `holdout ${holdoutId} names fixture ${expected}, which is also registered as holdout ${otherId}${other.consumedOn !== undefined ? ` (consumed on ${other.consumedOn})` : ""}; one fixture, one holdout`;
    }
  }
  if (detectorVersion !== h.evaluatedWith) {
    return `holdout ${holdoutId} is reserved for detector ${h.evaluatedWith}, not ${detectorVersion}`;
  }
  return undefined;
}

/**
 * Why a run must not happen, or undefined when it may. Checked before the holdout is loaded.
 * `registry` is a test seam only (T6); production uses the committed registry.
 */
export function holdoutRunRefusal(
  holdoutId: string,
  detectorVersion: string,
  registry?: ReadonlyMap<string, LanguageHoldoutRecord>,
): string | undefined {
  return refusalOn(
    registry ? snapshotOf(registry) : committedSnapshot(),
    holdoutId,
    detectorVersion,
  );
}

export type HoldoutRunResult =
  | { readonly ran: true; readonly fixture: string; readonly specifier: string }
  | { readonly ran: false; readonly refusal: string };

/**
 * Runs the guard on one registry snapshot, then (only if it passes) imports the module built from
 * `holdoutFixtureFor(id)` and evaluates it. `importModule` receives that specifier and nothing
 * else; it returns the holdout rows, or undefined when the module does not export valid rows. A
 * failed import, a missing export or an empty row list is a refusal, and nothing is evaluated.
 *
 * `registry` is a test seam only: production callers (the evaluation script) never pass it, so
 * the committed `LANGUAGE_HOLDOUTS` is what decides in a real run (T6).
 */
export async function runHoldoutEvaluation<T extends readonly unknown[]>(options: {
  readonly holdoutId: string;
  readonly detectorVersion: string;
  readonly importModule: (specifier: string) => Promise<T | undefined>;
  readonly evaluate: (holdout: T) => void;
  /** Test seam only; see above. */
  readonly registry?: ReadonlyMap<string, LanguageHoldoutRecord>;
}): Promise<HoldoutRunResult> {
  const holdoutId = options.holdoutId;
  const snapshot = options.registry ? snapshotOf(options.registry) : committedSnapshot();
  const refusal = refusalOn(snapshot, holdoutId, options.detectorVersion);
  if (refusal !== undefined) return { ran: false, refusal };
  // Built from the id itself (validated above to equal the snapshot's record), never re-read.
  const fixture = holdoutFixtureFor(holdoutId)!;
  const specifier = holdoutModuleSpecifier(fixture);
  let holdout: T | undefined;
  try {
    holdout = await options.importModule(specifier);
  } catch (e) {
    return { ran: false, refusal: `cannot import ${specifier}: ${(e as Error).message}` };
  }
  if (holdout === undefined) {
    return {
      ran: false,
      refusal: `${specifier} does not export valid LANGUAGE_DETECT_HOLDOUT rows`,
    };
  }
  if (holdout.length === 0) {
    return {
      ran: false,
      refusal: `${specifier} exports no rows; an empty holdout is not evaluated`,
    };
  }
  options.evaluate(holdout);
  return { ran: true, fixture, specifier };
}

/** One holdout row as the evaluation reads it. */
export interface LanguageHoldoutRow {
  readonly id: string;
  readonly category: string;
  readonly text: string;
  readonly allowedDecisive: "ru" | "uk" | "en" | null;
}

const ALLOWED = new Set<unknown>(["ru", "uk", "en", null]);

/**
 * The rows of a holdout module's export, or undefined when the export is not an array of
 * well-formed rows (U2, V3). A row is well formed when `id`, `category` and `text` are non-blank
 * strings and `allowedDecisive` is ru, uk, en or null; row ids must be unique. Each field is read
 * once into a frozen plain copy, so what is validated is exactly what is evaluated. Never prints or
 * returns a text on failure.
 */
export function holdoutRowsOf(value: unknown): readonly LanguageHoldoutRow[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: LanguageHoldoutRow[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    if (!(i in value)) return undefined; // a hole in a sparse array
    const r: unknown = value[i];
    if (typeof r !== "object" || r === null) return undefined;
    const source = r as Record<string, unknown>;
    const id = source["id"];
    const category = source["category"];
    const text = source["text"];
    const allowedDecisive = source["allowedDecisive"];
    const nonBlank = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
    if (!nonBlank(id) || !nonBlank(category) || !nonBlank(text) || !ALLOWED.has(allowedDecisive)) {
      return undefined;
    }
    if (ids.has(id)) return undefined;
    ids.add(id);
    rows.push(
      Object.freeze({
        id,
        category,
        text,
        allowedDecisive: allowedDecisive as LanguageHoldoutRow["allowedDecisive"],
      }),
    );
  }
  return Object.freeze(rows);
}

// ── V4: independence of a new holdout from the consumed ones ────────────────────────────────────

/** The documented, deterministic text canonicalisation behind the V4 hash check. */
export const HOLDOUT_TEXT_HASH_METHOD =
  "sha256 hex of: Unicode NFC, then lower-cased (locale-independent), then every whitespace run collapsed to one space, then trimmed";

export function canonicalHoldoutText(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** Any import, re-export or require in a holdout module's source. A holdout is plain data. */
const MODULE_LINK = [
  /^\s*import\b/m,
  /\bimport\s*\(/,
  /\bexport\s*\*/,
  /\bexport\s*\{[^}]*\}\s*from\b/,
  /\brequire\s*\(/,
];

export interface HoldoutIndependence {
  readonly accepted: boolean;
  /** Why it is not accepted; never contains a text or an excerpt. */
  readonly reasons: readonly string[];
  readonly counts: {
    readonly newRows: number;
    readonly consumedRows: number;
    readonly idOverlap: number;
    readonly textHashOverlap: number;
    readonly duplicateTextsInNew: number;
  };
}

/**
 * V4 gate: is the new holdout independent of the consumed one(s)? Fails safe: rows that cannot be
 * read or verified, or a missing source, mean "not accepted". Reports counts and reasons only.
 */
export function holdoutIndependence(input: {
  /** SHA-256 hex of a string; injected so this module stays free of the hashing implementation. */
  readonly sha256: (text: string) => string;
  readonly newRows: unknown;
  readonly newSource: string | undefined;
  readonly consumedRows: unknown;
}): HoldoutIndependence {
  const reasons: string[] = [];
  const fresh = holdoutRowsOf(input.newRows);
  const consumed = holdoutRowsOf(input.consumedRows);
  if (fresh === undefined || fresh.length === 0)
    reasons.push("new holdout rows cannot be read or verified");
  if (consumed === undefined || consumed.length === 0) {
    reasons.push("consumed holdout rows cannot be read or verified");
  }
  if (typeof input.newSource !== "string" || input.newSource.length === 0) {
    reasons.push("new holdout source cannot be read");
  } else if (MODULE_LINK.some((re) => re.test(input.newSource!))) {
    reasons.push("new holdout module imports, re-exports or requires another module");
  }
  const consumedIds = new Set((consumed ?? []).map((r) => r.id));
  const hash = (text: string) => input.sha256(canonicalHoldoutText(text));
  const consumedHashes = new Set((consumed ?? []).map((r) => hash(r.text)));
  const freshHashes = (fresh ?? []).map((r) => hash(r.text));
  const idOverlap = (fresh ?? []).filter((r) => consumedIds.has(r.id)).length;
  const textHashOverlap = freshHashes.filter((h) => consumedHashes.has(h)).length;
  const duplicateTextsInNew = freshHashes.length - new Set(freshHashes).size;
  if (idOverlap > 0) reasons.push(`${idOverlap} row id(s) overlap the consumed holdout`);
  if (textHashOverlap > 0) {
    reasons.push(`${textHashOverlap} canonical text hash(es) overlap the consumed holdout`);
  }
  if (duplicateTextsInNew > 0) {
    reasons.push(`${duplicateTextsInNew} canonical text(s) repeat within the new holdout`);
  }
  return {
    accepted: reasons.length === 0,
    reasons,
    counts: {
      newRows: fresh?.length ?? 0,
      consumedRows: consumed?.length ?? 0,
      idOverlap,
      textHashOverlap,
      duplicateTextsInNew,
    },
  };
}
