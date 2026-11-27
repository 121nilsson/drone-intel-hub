/**
 * Guard for the single holdout evaluation of the language detector (review findings R5, Q1, T1, T5).
 *
 * A holdout supports approval of exactly one frozen detector version, once. After that it is
 * consumed: running it again, and above all running it with a newer detector, yields figures that
 * could be cited as approval evidence for a version that was never evaluated on unseen data. The
 * guard refuses such a run before the holdout is loaded, so its texts are never touched.
 *
 * Identity, not configuration, decides what is loaded:
 * - the id has a strict form (`v1`, `v2`, …) and its fixture name is derived from it
 *   (`holdoutFixtureFor`); a registry record that names any other fixture is refused (T5), so a
 *   variant spelling (`language-detect-holdout.ts`, `./…`, upper case, another id's name) can
 *   never pass;
 * - the module that is imported is derived from that same fixture name (`holdoutModuleSpecifier`),
 *   so name and import path cannot drift apart (T1);
 * - a fixture that any id has consumed is refused under every id.
 * Every refusal happens before anything is imported or evaluated.
 */

export interface LanguageHoldoutRecord {
  /** Fixture module name under `src/test/fixtures`; must equal `holdoutFixtureFor(id)`. */
  readonly fixture: string;
  /** The only detector version this holdout may be evaluated with. */
  readonly evaluatedWith: string;
  /** Date of the single evaluation; set once it has run. A consumed holdout never runs again. */
  readonly consumedOn?: string;
}

export const LANGUAGE_HOLDOUTS: ReadonlyMap<string, LanguageHoldoutRecord> = new Map([
  ["v1", { fixture: "language-detect-holdout", evaluatedWith: "3.0.0", consumedOn: "2026-11-27" }],
]);

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

/** Why a run must not happen, or undefined when it may. Checked before the holdout is loaded. */
export function holdoutRunRefusal(
  holdoutId: string,
  detectorVersion: string,
  registry: ReadonlyMap<string, LanguageHoldoutRecord> = LANGUAGE_HOLDOUTS,
): string | undefined {
  const expected = holdoutFixtureFor(holdoutId);
  if (expected === undefined) return `invalid holdout id "${holdoutId}" (expected v1, v2, …)`;
  const h = registry.get(holdoutId);
  if (!h) return `unknown holdout "${holdoutId}"`;
  if (h.fixture !== expected) {
    return `holdout ${holdoutId} names fixture "${h.fixture}", but its fixture must be "${expected}"`;
  }
  if (h.consumedOn !== undefined) {
    return `holdout ${holdoutId} was consumed on ${h.consumedOn} by detector ${h.evaluatedWith}; a new run is not approval evidence for any version, including ${detectorVersion}`;
  }
  for (const [otherId, other] of registry) {
    if (otherId !== holdoutId && other.fixture === h.fixture) {
      return `holdout ${holdoutId} names fixture ${h.fixture}, which is also registered as holdout ${otherId}${other.consumedOn !== undefined ? ` (consumed on ${other.consumedOn})` : ""}; one fixture, one holdout`;
    }
  }
  if (detectorVersion !== h.evaluatedWith) {
    return `holdout ${holdoutId} is reserved for detector ${h.evaluatedWith}, not ${detectorVersion}`;
  }
  return undefined;
}

export type HoldoutRunResult =
  | { readonly ran: true; readonly fixture: string; readonly specifier: string }
  | { readonly ran: false; readonly refusal: string };

/**
 * Runs the guard, then (only if it passes) imports the module derived from the holdout's fixture
 * name and evaluates it. `importModule` receives that derived specifier and nothing else; it
 * returns the holdout rows, or undefined when the module does not export them. A failed or empty
 * import is a refusal, never a fallback, and nothing is evaluated.
 *
 * `registry` is a test seam only: production callers (the evaluation script) never pass it, so
 * the committed `LANGUAGE_HOLDOUTS` is what decides in a real run (T6).
 */
export async function runHoldoutEvaluation<T>(options: {
  readonly holdoutId: string;
  readonly detectorVersion: string;
  readonly importModule: (specifier: string) => Promise<T | undefined>;
  readonly evaluate: (holdout: T) => void;
  /** Test seam only; see above. */
  readonly registry?: ReadonlyMap<string, LanguageHoldoutRecord>;
}): Promise<HoldoutRunResult> {
  const registry = options.registry ?? LANGUAGE_HOLDOUTS;
  const refusal = holdoutRunRefusal(options.holdoutId, options.detectorVersion, registry);
  if (refusal !== undefined) return { ran: false, refusal };
  const fixture = registry.get(options.holdoutId)!.fixture;
  const specifier = holdoutModuleSpecifier(fixture);
  let holdout: T | undefined;
  try {
    holdout = await options.importModule(specifier);
  } catch (e) {
    return { ran: false, refusal: `cannot import ${specifier}: ${(e as Error).message}` };
  }
  if (holdout === undefined) {
    return { ran: false, refusal: `${specifier} does not export LANGUAGE_DETECT_HOLDOUT` };
  }
  options.evaluate(holdout);
  return { ran: true, fixture, specifier };
}
