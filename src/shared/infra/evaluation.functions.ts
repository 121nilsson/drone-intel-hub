import { createServerFn } from "@tanstack/react-start";
import type { Candidate } from "@/entities/drone/types";
import {
  runEvaluation,
  runEvaluationHealth,
  importGitCorpus,
  harvestCorpus,
  runAdjudication,
  minePatterns,
  approveOverride,
  rejectOverride,
  recordAnalystFixture,
  getEvalReports,
  type PatternSuggestion,
} from "./evaluation.server";

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

export const triggerMinePatterns = createServerFn({ method: "POST" }).handler(async () => {
  return await minePatterns();
});

export const triggerApproveOverride = createServerFn({ method: "POST" })
  .validator((d: { suggestion: PatternSuggestion }) => d)
  .handler(async ({ data }) => {
    return await approveOverride(data.suggestion);
  });

export const triggerRejectOverride = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    return await rejectOverride(data.id);
  });

export const triggerRecordAnalyst = createServerFn({ method: "POST" })
  .validator((d: { candidate: unknown }) => d)
  .handler(async ({ data }) => {
    return await recordAnalystFixture(data.candidate as Candidate);
  });

export const fetchEvalReports = createServerFn({ method: "GET" }).handler(async () => {
  return await getEvalReports(20);
});
