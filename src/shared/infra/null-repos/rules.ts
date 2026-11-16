import type { RulesRepo } from "@/shared/contracts/rules-repo";

/**
 * Used when the backend has no SQL database. Every entry point to the rule loops checks
 * `backend.capabilities.sql` first and returns empty-handed, so this adapter is only reached by a
 * caller that skipped that check; it answers neutrally (reads are empty, writes move nothing, the
 * lock reports "no database configured"). Unlike the evaluation, audit and verification adapters
 * it does not throw: the old rule helpers that never guarded threw "DATABASE_URL not set", so a
 * future unguarded caller gets a silent no-op here and must keep the capability check.
 */
export const nullRulesRepo: RulesRepo = {
  async findRule() {
    return null;
  },
  async activeRules() {
    return [];
  },
  async rulesVersion() {
    return 0;
  },
  async ruleIds() {
    return [];
  },
  async ruleTarget() {
    return null;
  },
  async shadowRules() {
    return [];
  },
  async quarantinedGenerated() {
    return [];
  },
  async activeRulesWithRecency() {
    return [];
  },
  async ruleListRows() {
    return [];
  },

  async recordDecision() {},
  async appendVersion() {},
  async decisions() {
    return [];
  },
  async autoActivatedLast24h() {
    return 0;
  },
  async recentDecisions() {
    return [];
  },
  async decisionHistory() {
    return [];
  },

  async insertCandidate() {},
  async settleCandidate() {
    return false;
  },
  async startShadow() {
    return false;
  },
  async rejectShadow() {
    return false;
  },
  async activate() {},
  async rejectOrQuarantine() {
    return null;
  },
  async quarantineActive() {
    return false;
  },
  async returnToShadow() {
    return false;
  },
  async saveShadowMetrics() {},
  async recordEvaluation() {},

  async candidatesMentioning() {
    return [];
  },
  async candidateSample() {
    return [];
  },
  async candidatesSince() {
    return [];
  },
  async candidatesBySource() {
    return [];
  },
  async analystResolvedCandidates() {
    return [];
  },
  async corpusFixtures() {
    return [];
  },

  async withActivationLock() {
    return { ok: false, reason: "no database configured" };
  },
};
