/**
 * Guard for the single holdout evaluation of the language detector (review finding R5).
 *
 * A holdout supports approval of exactly one frozen detector version, once. After that it is
 * consumed: running it again, and above all running it with a newer detector, yields figures that
 * could be cited as approval evidence for a version that was never evaluated on unseen data. The
 * guard refuses such a run before the holdout is loaded, so its texts are never touched.
 */

export interface LanguageHoldoutRecord {
  /** Fixture module name under `src/test/fixtures`. */
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
  if (detectorVersion !== h.evaluatedWith) {
    return `holdout ${holdoutId} is reserved for detector ${h.evaluatedWith}, not ${detectorVersion}`;
  }
  return undefined;
}

/**
 * Runs the guard, then (only if it passes) loads the holdout and evaluates it. `load` is injected
 * so that the refusal path is testable without ever importing the holdout.
 */
export async function runHoldoutEvaluation<T>(options: {
  readonly holdoutId: string;
  readonly detectorVersion: string;
  readonly load: () => Promise<T>;
  readonly evaluate: (holdout: T) => void;
}): Promise<{ readonly ran: true } | { readonly ran: false; readonly refusal: string }> {
  const refusal = holdoutRunRefusal(options.holdoutId, options.detectorVersion);
  if (refusal !== undefined) return { ran: false, refusal };
  options.evaluate(await options.load());
  return { ran: true };
}
