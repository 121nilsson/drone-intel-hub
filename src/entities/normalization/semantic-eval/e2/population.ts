/**
 * E2 pipeline, step b (1/3): freeze the population. Pure: no resolver, no snapshot, no detector.
 *
 * Rows are dropped for the same resolver-independent reasons as `freezeFrame` (counted per reason),
 * each kept row stores its excerpt (<= 300 chars) and its routing stratum (the pre-D0 rule on that
 * stored excerpt: an allocation key only), and identical evidence collapses to one row per
 * evidence cluster.
 *
 * Cluster rule. Rows are visited in one explicit canonical order (the full row's canonical JSON,
 * compared by UTF-16 code units, so no locale and no input order is involved). The first row of a
 * cluster is kept. A cluster whose rows differ in declared language, context, origin, family or
 * routing stratum is excluded WHOLE as `conflicting_evidence_metadata` (counted once per cluster).
 * The cluster key lower-cases and NFKC-normalises the excerpt, so a cluster can hold excerpts that
 * differ in case only. The routing rule is symmetric in case, so such rows get the same stratum and
 * the first canonical row is kept with its own text. Variants that are equal only after NFKC (for
 * example the Kelvin sign) can get different strata: that cluster is a conflict and is excluded, so
 * the stratum of a kept row never depends on which duplicate happened to sort first.
 */

import { sha256Hex } from "../../sha256";
import { FRAME_CUTOFF, type FrameRow } from "../types";
import {
  classifyFamily,
  evidenceClusterIdFor,
  exampleIdFor,
  sourceClusterIdFor,
} from "../frame-identity";
import { canonicalJson, toJsonl } from "../validate";
import {
  E2_DECLARED_LANGUAGES,
  E2_ROUTING_RULE,
  E2_ROUTING_RULE_SOURCE_COMMIT,
  E2_SCHEMA_VERSION,
  ROUTING_STRATA,
  type E2DeclaredLanguage,
  type E2Example,
  type E2Exclusion,
  type E2PopulationManifest,
  type RoutingStratum,
} from "./types";
import {
  e2RoutingStratum,
  e2StoredExcerpt,
  validateE2Example,
  validateE2PopulationManifest,
} from "./validate";

export interface E2FreezeOptions {
  readonly cutoff?: string;
  readonly defaultOrigin?: FrameRow["origin"];
  /** SHA-256 of the exact export bytes; supplied by the CLI, never derived from the rows. */
  readonly rawExportSha256: string;
}

export interface E2Population {
  /** Sorted by exampleId (code units). */
  readonly rows: readonly E2Example[];
  readonly manifest: E2PopulationManifest;
}

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Canonical rows file: one canonical JSON object per line, rows sorted by exampleId. */
export function e2RowsJsonl(rows: readonly E2Example[]): string {
  return toJsonl([...rows].sort((a, b) => byCodeUnits(a.exampleId, b.exampleId)));
}

function bump(map: Map<string, number>, reason: string): void {
  map.set(reason, (map.get(reason) ?? 0) + 1);
}

function describeRow(row: FrameRow): string {
  return `row ${row.sourceId}/${row.rawKey}`;
}

export function freezeE2Population(
  rows: readonly FrameRow[],
  options: E2FreezeOptions,
): E2Population {
  const cutoff = options.cutoff ?? FRAME_CUTOFF;
  const cutoffMs = Date.parse(cutoff);
  if (Number.isNaN(cutoffMs)) throw new Error(`invalid cutoff: ${cutoff}`);

  // Language input is checked on every row first, including rows that are dropped later: a frame
  // that carries a legacy or unknown language is refused as a whole, never partly.
  for (const row of rows) {
    if (row.language !== undefined) {
      throw new Error(
        `${describeRow(row)} sets the legacy language field; schema 1.2.0 does not read it, use declaredLanguage (en, ru or uk) or leave it out`,
      );
    }
    const d: unknown = row.declaredLanguage;
    if (d !== undefined && !E2_DECLARED_LANGUAGES.includes(d as E2DeclaredLanguage)) {
      throw new Error(
        `${describeRow(row)} has declaredLanguage ${JSON.stringify(d)}; schema 1.2.0 allows en, ru, uk or no declaration (unknown is not a declaration)`,
      );
    }
  }

  const exclusions = new Map<string, number>();
  const ordered = [...rows].sort((a, b) => byCodeUnits(canonicalJson(a), canonicalJson(b)));
  const candidates: E2Example[] = [];
  for (const row of ordered) {
    if (row.rawKey.trim().length === 0) {
      bump(exclusions, "empty_raw_key");
      continue;
    }
    if (row.excerpt.trim().length === 0) {
      bump(exclusions, "empty_excerpt");
      continue;
    }
    if (row.publishedAt === undefined) {
      bump(exclusions, "missing_published_at");
      continue;
    }
    const publishedMs = Date.parse(row.publishedAt);
    if (Number.isNaN(publishedMs)) {
      bump(exclusions, "invalid_published_at");
      continue;
    }
    if (publishedMs > cutoffMs) {
      bump(exclusions, "after_cutoff");
      continue;
    }
    const excerpt = e2StoredExcerpt(row.excerpt);
    const declared = row.declaredLanguage as E2DeclaredLanguage | undefined;
    candidates.push(
      validateE2Example({
        exampleId: exampleIdFor(row),
        sourceClusterId: sourceClusterIdFor(row),
        evidenceClusterId: evidenceClusterIdFor(row),
        source: {
          id: row.sourceId,
          ...(row.url !== undefined ? { url: row.url } : {}),
          publishedAt: row.publishedAt,
        },
        excerpt,
        routingStratum: e2RoutingStratum(excerpt),
        ...(declared !== undefined ? { declaredLanguage: declared } : {}),
        rawKey: row.rawKey,
        ...(row.rawLabel !== undefined ? { rawLabel: row.rawLabel } : {}),
        ...(row.rawValue !== undefined ? { rawValue: row.rawValue } : {}),
        ...(row.rawUnit !== undefined ? { rawUnit: row.rawUnit } : {}),
        context: {
          ...(row.domain !== undefined ? { domain: row.domain } : {}),
          ...(row.systemClass !== undefined ? { systemClass: row.systemClass } : {}),
          ...(row.subsystem !== undefined ? { subsystem: row.subsystem } : {}),
        },
        family: classifyFamily(row.rawKey, row.rawLabel),
        origin: row.origin ?? options.defaultOrigin ?? "historical",
        frameId: "pending",
        schemaVersion: E2_SCHEMA_VERSION,
      }),
    );
  }

  const byEvidence = new Map<string, E2Example[]>();
  for (const example of candidates) {
    const list = byEvidence.get(example.evidenceClusterId) ?? [];
    list.push(example);
    byEvidence.set(example.evidenceClusterId, list);
  }
  const conflicting = new Set<string>();
  for (const [id, group] of byEvidence) {
    const signatures = new Set(
      group.map((e) =>
        canonicalJson({
          declaredLanguage: e.declaredLanguage,
          context: e.context,
          origin: e.origin,
          family: e.family,
          routingStratum: e.routingStratum,
        }),
      ),
    );
    if (signatures.size > 1) {
      conflicting.add(id);
      bump(exclusions, "conflicting_evidence_metadata");
    }
  }

  const seenEvidence = new Set<string>();
  const seenIds = new Set<string>();
  const kept: E2Example[] = [];
  for (const example of candidates) {
    if (conflicting.has(example.evidenceClusterId)) continue;
    if (seenEvidence.has(example.evidenceClusterId)) {
      bump(exclusions, "duplicate_evidence");
      continue;
    }
    if (seenIds.has(example.exampleId)) {
      bump(exclusions, "duplicate_example_id");
      continue;
    }
    seenEvidence.add(example.evidenceClusterId);
    seenIds.add(example.exampleId);
    kept.push(example);
  }

  kept.sort((a, b) => byCodeUnits(a.exampleId, b.exampleId));
  const frameId = sha256Hex(kept.map((e) => e.exampleId).join("|"));
  const population = kept.map((e) => ({ ...e, frameId }));

  const stratumCounts = Object.fromEntries(ROUTING_STRATA.map((s) => [s, 0])) as Record<
    RoutingStratum,
    number
  >;
  for (const e of population) stratumCounts[e.routingStratum]++;

  const exclusionList: E2Exclusion[] = [...exclusions.entries()]
    .sort(([a], [b]) => byCodeUnits(a, b))
    .map(([reason, count]) => ({ reason, count }));
  const manifest = validateE2PopulationManifest({
    stage: "population",
    schemaVersion: E2_SCHEMA_VERSION,
    routingRule: E2_ROUTING_RULE,
    routingRuleSourceCommit: E2_ROUTING_RULE_SOURCE_COMMIT,
    cutoff,
    frameId,
    rawExportSha256: options.rawExportSha256,
    populationRowsSha256: sha256Hex(e2RowsJsonl(population)),
    populationCount: population.length,
    stratumCounts,
    exclusions: exclusionList,
  });
  return { rows: population, manifest };
}
