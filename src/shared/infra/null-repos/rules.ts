import type { RulesRepo } from "@/shared/contracts/rules-repo";

/**
 * Used when the backend has no SQL database. Every rule flow was guarded by dbConfigured() and
 * returned empty-handed, so reads are empty, writes move nothing and the lock reports the
 * "no database configured" reason that activation always gave.
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
