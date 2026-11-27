/**
 * E2 pipeline, step b (3/3): the seeded draw, within each routing stratum.
 *
 * It is the Phase 3.2 algorithm with the stratum key replaced (design section 5): ids of a stratum
 * sorted by code units, RNG seed = first 8 hex digits of SHA-256(`seed|stratum`) fed to mulberry32
 * (`seededRandom`), Fisher-Yates `shuffle`, first n_h taken. It imports only those two helpers from
 * the existing code; the result depends on the id set, never on the input order.
 */

import { seededRandom, shuffle } from "../../../drone/audit";
import { sha256Hex } from "../../sha256";
import type { E2Allocation } from "./allocation";
import { e2RowsJsonl, type E2Population } from "./population";
import { E2_SCHEMA_VERSION, ROUTING_STRATA, type E2Example, type E2SampleManifest } from "./types";
import type { RoutingStratum } from "./types";
import { checkE2Allocation, e2ManifestHash, validateE2SampleManifest } from "./validate";

export interface E2Sample {
  /** Sorted by exampleId (code units). */
  readonly rows: readonly E2Example[];
  readonly manifest: E2SampleManifest;
}

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function drawE2Sample(
  population: E2Population,
  allocation: E2Allocation,
  seed: string,
): E2Sample {
  if (seed.length === 0) throw new Error("seed must not be empty");
  const problems = checkE2Allocation(allocation.strata, allocation.n);
  if (problems.length > 0) throw new Error(`invalid allocation: ${problems.join("; ")}`);
  if (sha256Hex(e2RowsJsonl(population.rows)) !== population.manifest.populationRowsSha256) {
    throw new Error("the population rows do not match the population manifest hash");
  }

  const byStratum = new Map<RoutingStratum, E2Example[]>(ROUTING_STRATA.map((s) => [s, []]));
  for (const e of population.rows) byStratum.get(e.routingStratum)!.push(e);
  for (const a of allocation.strata) {
    const actual = byStratum.get(a.stratum)!.length;
    if (actual !== a.populationCount || actual !== population.manifest.stratumCounts[a.stratum]) {
      throw new Error(
        `stratum ${a.stratum}: allocation says N_h ${a.populationCount}, population has ${actual}`,
      );
    }
  }

  const drawn: E2Example[] = [];
  for (const a of allocation.strata) {
    if (a.sampleCount === 0) continue;
    const rows = byStratum.get(a.stratum)!;
    const ids = rows.map((e) => e.exampleId).sort(byCodeUnits);
    const stratumSeed = Number.parseInt(sha256Hex(`${seed}|${a.stratum}`).slice(0, 8), 16);
    const chosen = new Set(shuffle(ids, seededRandom(stratumSeed)).slice(0, a.sampleCount));
    for (const e of rows) if (chosen.has(e.exampleId)) drawn.push(e);
  }
  drawn.sort((a, b) => byCodeUnits(a.exampleId, b.exampleId));

  const manifest = validateE2SampleManifest({
    stage: "sample",
    schemaVersion: E2_SCHEMA_VERSION,
    populationManifestSha256: e2ManifestHash(population.manifest),
    seed,
    n: allocation.n,
    m: allocation.m,
    strata: allocation.strata,
    redistributionRounds: allocation.redistributionRounds,
    drawnExampleIds: drawn.map((e) => e.exampleId),
    drawnRowsSha256: sha256Hex(e2RowsJsonl(drawn)),
  });
  return { rows: drawn, manifest };
}
