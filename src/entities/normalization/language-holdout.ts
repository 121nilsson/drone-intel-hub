/**
 * Guard for the single holdout evaluation of the language detector (review findings R5, Q1).
 *
 * A holdout supports approval of exactly one frozen detector version, once. After that it is
 * consumed: running it again, and above all running it with a newer detector, yields figures that
 * could be cited as approval evidence for a version that was never evaluated on unseen data. The
 * guard refuses such a run before the holdout is loaded, so its texts are never touched.
 *
 * The fixture to load is the one the registry names for the holdout id, never a default: a loader
 * is looked up by that fixture name, so one id can never load another id's texts (Q1). A fixture
 * that any id has consumed is refused under every id, so a consumed set cannot be re-registered
 * under a new name.
 */

export interface LanguageHoldoutRecord {
  /** Fixture module name under `src/test/fixtures`; selects the loader. */
  readonly fixture: string;
  /** The only detector version this holdout may be evaluated with. */
  readonly evaluatedWith: string;
  /** Date of the single evaluation; set once it has run. A consumed holdout never runs again. */
  readonly consumedOn?: string;
}

export const LANGUAGE_HOLDOUTS: ReadonlyMap<string, LanguageHoldoutRecord> = new Map([
  ["v1", { fixture: "language-detect-holdout", evaluatedWith: "3.0.0", consumedOn: "2026-11-27" }],
]);

/** Why a run must not happen, or undefined when it may. Checked before the holdout is loaded. */
export function holdoutRunRefusal(
  holdoutId: string,
  detectorVersion: string,
  registry: ReadonlyMap<string, LanguageHoldoutRecord> = LANGUAGE_HOLDOUTS,
): string | undefined {
  const h = registry.get(holdoutId);
  if (!h) return `unknown holdout "${holdoutId}"`;
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
  | { readonly ran: true; readonly fixture: string }
  | { readonly ran: false; readonly refusal: string };

/**
 * Runs the guard, then (only if it passes) loads the fixture the registry names for the id and
 * evaluates it. Loaders are keyed by fixture name and injected, so the refusal paths are testable
 * without importing any holdout; a missing loader is a refusal, never a fallback.
 */
export async function runHoldoutEvaluation<T>(options: {
  readonly holdoutId: string;
  readonly detectorVersion: string;
  readonly loaders: ReadonlyMap<string, () => Promise<T>>;
  readonly evaluate: (holdout: T) => void;
  readonly registry?: ReadonlyMap<string, LanguageHoldoutRecord>;
}): Promise<HoldoutRunResult> {
  const registry = options.registry ?? LANGUAGE_HOLDOUTS;
  const refusal = holdoutRunRefusal(options.holdoutId, options.detectorVersion, registry);
  if (refusal !== undefined) return { ran: false, refusal };
  const fixture = registry.get(options.holdoutId)!.fixture;
  const load = options.loaders.get(fixture);
  if (!load) {
    return {
      ran: false,
      refusal: `no loader for fixture ${fixture} (holdout ${options.holdoutId}); add it to the script's loader map`,
    };
  }
  options.evaluate(await load());
  return { ran: true, fixture };
}
