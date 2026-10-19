import { createServerFn } from "@tanstack/react-start";
import type { Candidate } from "@/entities/drone/types";
import {
  runEvaluation,
  runEvaluationHealth,
  importGitCorpus,
  harvestCorpus,
  runAdjudication,
  recordAnalystFixture,
  getEvalReports,
  getEvalKeyTrends,
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
  return await listRules();
});

export const triggerProposeRule = createServerFn({ method: "POST" })
  .validator((d: ProposeInput) => d)
  .handler(async ({ data }) => {
    return await proposeRule({ ...data, origin: "analyst" });
  });

export const triggerSandboxRule = createServerFn({ method: "POST" })
  .validator((d: { id: string; mode?: "fast" | "full" }) => d)
  .handler(async ({ data }) => {
    return await sandboxRule(data.id, data.mode === "full" ? "full" : "fast");
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

export const triggerRecordAnalyst = createServerFn({ method: "POST" })
  .validator((d: { candidate: unknown }) => d)
  .handler(async ({ data }) => {
    return await recordAnalystFixture(data.candidate as Candidate);
  });

export const fetchEvalReports = createServerFn({ method: "GET" }).handler(async () => {
  return await getEvalReports(20);
});

export const fetchEvalKeyTrends = createServerFn({ method: "GET" }).handler(async () => {
  return await getEvalKeyTrends(20);
});
