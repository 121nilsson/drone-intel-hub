/**
 * Plain labels for the decision ledger's event kinds. Partial on purpose: a kind the contract does
 * not list yet still builds, and shows its raw kind until someone labels it.
 */
export const EVENT_LABELS: Partial<Record<string, string>> = {
  verification_run: "Verification run",
  rule_probation_started: "Rule back on probation",
  rule_replay_requested: "Posts re-analysed after quarantine",
  verifier_control_run: "Verifier controls asked",
  source_reenabled: "Source re-enabled by probe",
};

export function eventLabel(kind: string): string {
  return EVENT_LABELS[kind] ?? kind;
}
