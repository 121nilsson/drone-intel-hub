/**
 * One-off repair: give stored claims a parsed quantity (`normalized`) when they have none.
 *
 * 769 of 1829 claims had no reading - some are text ("GPS"), but many are figures that were stored
 * before the parser read them ("up to 500 km", "approximately 46 km/h"). Consensus compares
 * `normalized`, so those claims were compared by a bare number, and the audit page showed them
 * without their qualifier.
 *
 * The write changes what consensus sees, so the default is a DRY RUN that prints, per spec, the
 * consensus before and after. Nothing is written without --apply, and a write is a normal
 * conditional `put` (the revision it read), so a document someone changed meanwhile is skipped.
 *
 *   npx tsx --env-file=.env.local scripts/renormalize-claims.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/renormalize-claims.ts --apply   # write
 *
 * Idempotent: a claim that has a reading is left alone, an analyst's claim is never touched.
 */
import type { Drone } from "@/entities/drone/types";
import { consensus } from "@/entities/drone/consensus";
import { renormalizeClaim, renormalizeSpec } from "@/entities/normalization/renormalize";
import { DocumentConflictError } from "@/shared/contracts/store";

const apply = process.argv.includes("--apply");
async function main() {
  // Imported here, not at the top: a *.server.ts module may only be loaded by a server entry.
  const { PostgresStore } = await import("@/shared/infra/postgres/postgres-store.server");
  const store = new PostgresStore();
  const loaded = (await store.load("drones")) ?? [];
  let claims = 0;
  let specsChanged = 0;
  let consensusChanged = 0;
  const byKey = new Map<string, number>();
  const shifts: string[] = [];
  const writes: { drone: Drone; rev: number }[] = [];

  for (const { doc, rev } of loaded) {
    let touched = false;
    const specs = doc.specs.map((spec) => {
      const next = renormalizeSpec(spec);
      if (next === spec) return spec;
      touched = true;
      specsChanged++;
      for (let i = 0; i < spec.claims.length; i++) {
        if (renormalizeClaim(spec, spec.claims[i]!) !== spec.claims[i]) {
          claims++;
          byKey.set(spec.key, (byKey.get(spec.key) ?? 0) + 1);
        }
      }
      const before = consensus(spec);
      const after = consensus(next);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        consensusChanged++;
        shifts.push(
          `  ${doc.name} | ${spec.label}: "${before.display}"${before.disputed ? " (disputed)" : ""} -> "${after.display}"${after.disputed ? " (disputed)" : ""}`,
        );
      }
      return next;
    });
    if (touched) writes.push({ drone: { ...doc, specs }, rev });
  }

  console.log(
    `${claims} claim(s) in ${specsChanged} spec(s) of ${writes.length} system(s) would get a reading.`,
  );
  console.log(
    `Consensus changes (display, spread, outliers, confidence or source count) in ${consensusChanged} spec(s):`,
  );
  for (const line of shifts.slice(0, 60)) console.log(line);
  if (shifts.length > 60) console.log(`  ... and ${shifts.length - 60} more`);
  console.log(
    "By attribute:",
    [...byKey.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([k, n]) => `${k} ${n}`)
      .join(", "),
  );

  if (!apply) {
    console.log("\nDry run. Nothing written. Pass --apply to write.");
    return;
  }
  let written = 0;
  let skipped = 0;
  for (const { drone, rev } of writes) {
    try {
      await store.put("drones", drone, rev);
      written++;
    } catch (e) {
      if (!(e instanceof DocumentConflictError)) throw e;
      skipped++;
    }
  }
  console.log(`\nWrote ${written} system(s); ${skipped} changed meanwhile and were skipped.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
