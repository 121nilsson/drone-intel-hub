import type { RuleKind, RuleLanguage } from "@/shared/contracts/rules";
import type { ShadowMetrics } from "@/shared/infra/evaluation/autonomy";
import type { SandboxResult } from "@/shared/infra/evaluation/sandbox";

/** Serializable JSON, so a RuleView can cross the server-function boundary. */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export interface RuleView {
  id: string;
  kind: string;
  language: string;
  payload: { [k: string]: Json };
  status: string;
  origin: string;
  targetKey: string | null;
  rationale: string | null;
  evidence: Json;
  createdAt: string;
  promotedAt: string | null;
  /** Shadow metrics plus what still blocks auto-promotion. */
  shadow: (ShadowMetrics & { blockers?: string[] }) | null;
  lastEvaluation: (SandboxResult & { evaluatedAt: string; rulesVersion: number | null }) | null;
}

export interface ProposeInput {
  kind: RuleKind;
  language?: RuleLanguage;
  payload: Record<string, unknown>;
  targetKey?: string;
  rationale?: string;
  evidence?: unknown;
  origin?: "analyst" | "autonomous_sandbox";
}
