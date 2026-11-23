/**
 * Phase 3.2 / S1: export the canonical concept reference for the FROZEN evaluation snapshot.
 *
 *   npx tsx scripts/export-canonical-concepts.ts                         # print to stdout
 *   npx tsx scripts/export-canonical-concepts.ts --report                 # write md + csv
 *   npx tsx scripts/export-canonical-concepts.ts --report --out <dir>
 *
 * Read-only with respect to production data. The reference is derived from CODE_SEED_RULES, the
 * exact rule set that produced CODE_SEED_SNAPSHOT; it is refused unless the frame's manifest stamps
 * that same snapshot hash. Nothing here consults the live registry, adds concepts, or touches a
 * claim or an existing decision.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { format, resolveConfig } from "prettier";
import {
  CODE_SEED_RULES,
  CODE_SEED_SNAPSHOT,
} from "../src/entities/normalization/semantic-resolver";
import {
  buildConceptCatalog,
  renderConceptCatalog,
  renderConceptCatalogCsv,
} from "../src/entities/normalization/semantic-eval/concepts";

const args = process.argv.slice(2);
const value = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

const manifestPath = resolve(
  value("--manifest", resolve("src/test/fixtures/semantic-eval/manifest.json")),
);
const outDir = resolve(value("--out", "scripts/output"));

function loadFrameSnapshotHash(): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new Error(`cannot read manifest ${manifestPath}: ${(e as Error).message}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { snapshotHash?: unknown }).snapshotHash !== "string"
  ) {
    throw new Error(`manifest ${manifestPath} has no snapshotHash`);
  }
  return (parsed as { snapshotHash: string }).snapshotHash;
}

async function main(): Promise<void> {
  const frameHash = loadFrameSnapshotHash();
  if (frameHash !== CODE_SEED_SNAPSHOT.contentHash) {
    throw new Error(
      `frame snapshot ${frameHash} is not the available snapshot ${CODE_SEED_SNAPSHOT.snapshotId} ` +
        `(${CODE_SEED_SNAPSHOT.contentHash}); no concept reference can be produced for it`,
    );
  }
  const catalog = buildConceptCatalog(CODE_SEED_RULES, CODE_SEED_SNAPSHOT);
  const markdown = await format(renderConceptCatalog(catalog), {
    filepath: "semantic-concepts.md",
    ...((await resolveConfig("semantic-concepts.md")) ?? {}),
  });
  const csv = renderConceptCatalogCsv(catalog);

  if (args.includes("--stdout") || !args.includes("--report")) {
    process.stdout.write(markdown);
    return;
  }
  mkdirSync(outDir, { recursive: true });
  const mdPath = resolve(outDir, "semantic-concepts.md");
  const csvPath = resolve(outDir, "semantic-concepts.csv");
  writeFileSync(mdPath, markdown);
  writeFileSync(csvPath, csv);
  process.stdout.write(
    `wrote ${catalog.concepts.length} concepts for ${catalog.snapshotId} (${catalog.snapshotHash})\n`,
  );
  process.stdout.write(`wrote ${mdPath}\n`);
  process.stdout.write(`wrote ${csvPath}\n`);
}

main().catch((e) => {
  process.stderr.write(`${(e as Error).message}\n`);
  process.exit(1);
});
