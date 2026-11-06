/**
 * Deterministic claim verification (Phase 1 of the autonomy plan).
 *
 * The verifier answers four questions that need no model: is the quoted evidence in the source,
 * is the figure measured in the unit the attribute uses, is it physically plausible, and does the
 * sentence name the system it was filed under. A claim that fails one of these is *rejected*
 * because the source or the arithmetic contradicts it. A claim whose checks cannot run, or whose
 * evidence does not name the system, is *uncertain* - stored and shown, never silently trusted.
 *
 * It never edits a claim's value, never removes a claim and never calls AI. Phase 1 keeps every
 * existing human gate; this only records what the machine can already prove.
 */

// Barrel: the verifier was split by concern into verification-*.ts. This file keeps the
// original import path and export surface stable for every caller.
export { VERIFIER_VERSION } from "./verification-check";
export { evidencePassages, fold } from "./verification-evidence";
export { independentSourceCount } from "./verification-sources";
export { sameVerification, verifyClaim } from "./verification-claim";
export {
  recheckDroneBounds,
  verifyDrone,
  verifyNewClaims,
  type ClaimTextResolver,
} from "./verification-drone";
export {
  verificationCoverage,
  verificationExceptions,
  type VerificationCoverage,
} from "./verification-coverage";
