import { createServerFn } from "@tanstack/react-start";
import {
  runEvaluation,
  runEvaluationHealth,
  importGitCorpus,
  harvestCorpus,
  runAdjudication,
  getEvalReports,
  getEvalKeyTrends,
  listPendingFixtures,
  decidePendingFixture,
} from "./evaluation.server";
import {
  activateRule,
  getAutonomyStatus,
  listRules,
  mineAndSandbox,
  proposeRule,
  rejectRule,
  runShadow,
  sandboxRule,
  shadowRule,
  superviseActiveRules,
  type ProposeInput,
} from "./rule-sandbox.server";

export const triggerEvaluation = createServerFn({ method: "POST" }).handler(async () => {
  return await runEvaluation();
});

export const triggerEvaluationHealth = createServerFn({ method: "POST" }).handler(async () => {
  return await runEvaluationHealth();
});

export const triggerGitImport = createServerFn({ method: "POST" }).handler(async () => {
  return await importGitCorpus();
});

export const triggerHarvest = createServerFn({ method: "POST" }).handler(async () => {
  return await harvestCorpus();
});

export const triggerAdjudication = createServerFn({ method: "POST" }).handler(async () => {
  return await runAdjudication();
});

export const triggerMineRules = createServerFn({ method: "POST" }).handler(async () => {
  return await mineAndSandbox();
});

export const fetchRules = createServerFn({ method: "GET" }).handler(async () => {
  const rules = await listRules();
  return rules.map((r) => ({
    ...r,
    // The evidence is a debugging aid: the rule's own samples, not the report it came from.
    // A long one is cut so the list stays readable; the full evidence stays in the database.
    evidence: typeof r.evidence === "string" ? r.evidence.slice(0, 200) : r.evidence,
  }));
});

export const triggerProposeRule = createServerFn({ method: "POST" })
  .validator((d: ProposeInput) => d)
  .handler(async ({ data }) => {
    return await proposeRule({ ...data, origin: "analyst" });
  });

export const triggerSandboxRule = createServerFn({ method: "POST" })
  .validator((d: { id: string; mode?: "fast" | "full" }) => d)
  .handler(async ({ data }) => {
    const r = await sandboxRule(data.id, data.mode === "full" ? "full" : "fast");
    if (!r.ok || !r.result) return r;
    const res = r.result;
    // A rule that breaks half the corpus would send every break and every preview to the
    // browser, so the lists are cut. The counts are not: a caller that reads
    // `regressions.length` must learn how many there were, not how many were sent.
    return {
      ok: r.ok,
      reason: r.reason,
      result: {
        passed: res.passed,
        reasons: res.reasons,
        mode: res.mode,
        corpusSize: res.corpusSize,
        regressionCount: res.regressions.length,
        fixedCount: res.fixed.length,
        regressions: res.regressions.slice(0, 5),
        fixed: res.fixed.slice(0, 5),
        affectedCandidates: res.affectedCandidates,
        changedCandidates: res.changedCandidates,
        before: res.before,
        after: res.after,
        f1Delta: res.f1Delta,
        preview: res.preview.slice(0, 5),
      },
    };
  });

export const triggerActivateRule = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    return await activateRule(data.id);
  });

export const triggerShadowRule = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    return await shadowRule(data.id);
  });

export const triggerRunShadow = createServerFn({ method: "POST" }).handler(async () => {
  return await runShadow();
});

export const triggerSupervise = createServerFn({ method: "POST" }).handler(async () => {
  return await superviseActiveRules();
});

export const fetchAutonomy = createServerFn({ method: "GET" }).handler(async () => {
  return await getAutonomyStatus();
});

export const triggerRejectRule = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    return await rejectRule(data.id);
  });

export const fetchEvalReports = createServerFn({ method: "GET" }).handler(async () => {
  return await getEvalReports(20);
});

export const fetchEvalKeyTrends = createServerFn({ method: "GET" }).handler(async () => {
  return await getEvalKeyTrends(20);
});

export const fetchPendingFixtures = createServerFn({ method: "GET" }).handler(async () => {
  return await listPendingFixtures(25);
});

export const triggerDecideFixture = createServerFn({ method: "POST" })
  .validator((d: { id: string; version: number; approve: boolean }) => d)
  .handler(async ({ data }) => {
    return await decidePendingFixture(data.id, data.version, data.approve === true);
  });
