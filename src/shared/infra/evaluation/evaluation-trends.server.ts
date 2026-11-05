import { db, dbConfigured } from "@/shared/infra/postgres/db.server";
import type { ReferenceCoverage } from "@/shared/infra/evaluation/evaluation";

export interface EvalReportRow {
  id: string;
  generatedAt: string;
  totalItems: number;
  f1: number;
  precision: number;
  recall: number;
  /** Absent on reports stored before the verified reference landed. */
  reference?: ReferenceCoverage;
}

export interface EvalKeyTrend {
  key: string;
  values: number[];
  dates: string[];
}

export async function getEvalKeyTrends(limit = 20): Promise<EvalKeyTrend[]> {
  if (!dbConfigured()) return [];
  // The newest `limit` reports, oldest first for the sparkline. Ordering ascending before the
  // limit took the oldest ones, so the trend froze once there were more than `limit` reports.
  const rows = await db()`
    select generated_at, report from (
      select generated_at, report from eval_reports order by generated_at desc limit ${limit}
    ) newest order by generated_at asc`;
  const byKey = new Map<string, { values: number[]; dates: string[] }>();
  for (const r of rows) {
    const rep = r["report"] as Record<string, unknown>;
    const perKey = (rep["perKey"] ?? {}) as Record<string, { f1: number }>;
    const date = (r["generated_at"] as Date).toISOString();
    for (const [k, v] of Object.entries(perKey)) {
      const e = byKey.get(k) ?? { values: [], dates: [] };
      e.values.push(typeof v.f1 === "number" ? v.f1 : 0);
      e.dates.push(date);
      byKey.set(k, e);
    }
  }
  return [...byKey.entries()]
    .map(([key, v]) => ({ key, values: v.values, dates: v.dates }))
    .sort((a, b) => b.values.length - a.values.length)
    .slice(0, 12);
}

export async function getEvalReports(limit = 20): Promise<EvalReportRow[]> {
  if (!dbConfigured()) return [];
  const rows =
    await db()`select id, generated_at, report from eval_reports order by generated_at desc limit ${limit}`;
  return rows.map((r) => {
    const rep = r["report"] as Record<string, unknown>;
    const summary = (rep["summary"] ?? {}) as Record<string, unknown>;
    const reference = rep["reference"] as ReferenceCoverage | undefined;
    return {
      id: r["id"] as string,
      generatedAt: (r["generated_at"] as Date).toISOString(),
      totalItems: (rep["totalItems"] as number) ?? 0,
      f1: typeof summary["f1"] === "number" ? (summary["f1"] as number) : 0,
      precision: typeof summary["precision"] === "number" ? (summary["precision"] as number) : 0,
      recall: typeof summary["recall"] === "number" ? (summary["recall"] as number) : 0,
      ...(reference && typeof reference.ratio === "number" ? { reference } : {}),
    };
  });
}
