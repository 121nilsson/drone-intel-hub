/**
 * Dry run: how many stored claims have a source unit the text shows, and how many are read through
 * the attribute's unit alone.
 *
 * A bare figure under an attribute with a unit ("105" under a kg attribute) is read today as that
 * unit. Once consensus and the unit check stop doing that, those claims become "unit unknown". This
 * script counts them first so the change can be reviewed against real data. It writes nothing.
 *
 *   npx tsx --env-file=.env.local scripts/report-claim-units.ts
 */
import type { SpecClaim } from "@/entities/drone/types";
import { claimSourceUnit } from "@/entities/normalization/claim-source-unit";
import { feedsNumbers, unitStanding, type UnitStanding } from "@/entities/drone/unit-policy";

type Basis = ReturnType<typeof claimSourceUnit>["basis"];

const BASES: readonly Basis[] = [
  "value_text",
  "quote",
  "extractor_unverified",
  "conflict",
  "unknown",
];

/** A claim whose value is a figure: a number, or text that writes one. */
const isNumeric = (claim: SpecClaim) =>
  typeof claim.value === "number" || /\d/.test(String(claim.value));

async function main() {
  // Imported here, not at the top: a *.server.ts module may only be loaded by a server entry.
  const { PostgresStore } = await import("@/shared/infra/postgres/postgres-store.server");
  const store = new PostgresStore();
  const loaded = (await store.load("drones")) ?? [];

  const counts = new Map<Basis, number>(BASES.map((b) => [b, 0]));
  let numericSpecs = 0;
  let numericClaims = 0;
  // Claims a bare figure reads through the attribute's unit only: no unit in the text, and the
  // attribute has one. These are the claims that would turn "unit unknown" under step B.
  let viaAttributeUnit = 0;
  const byAttribute = new Map<string, number>();
  const conflicts: string[] = [];
  // What the catalogue will do (unit-policy.ts), not just what the text shows: a figure an analyst,
  // the seed catalogue or a reference import gave with its unit is "declared" and still counts.
  const standings = new Map<UnitStanding, number>();
  const heldByAttribute = new Map<string, number>();
  const examples = new Map<string, string[]>();

  for (const { doc } of loaded) {
    for (const spec of doc.specs) {
      const claims = spec.claims.filter(isNumeric);
      if (!claims.length) continue;
      numericSpecs++;
      for (const claim of claims) {
        numericClaims++;
        const standing = unitStanding(spec, claim);
        standings.set(standing, (standings.get(standing) ?? 0) + 1);
        if (!feedsNumbers(standing)) {
          heldByAttribute.set(spec.key, (heldByAttribute.get(spec.key) ?? 0) + 1);
          const list = examples.get(spec.key) ?? [];
          if (list.length < 3)
            list.push(
              `    ${doc.name}: ${claim.raw ?? claim.value} ${spec.unit ?? ""} | ${claim.evidence ?? "no quote"}`,
            );
          examples.set(spec.key, list);
        }
        const source = claimSourceUnit(claim, spec);
        counts.set(source.basis, (counts.get(source.basis) ?? 0) + 1);
        if (source.basis === "unknown" || source.basis === "extractor_unverified") {
          if (spec.unit) {
            viaAttributeUnit++;
            byAttribute.set(spec.key, (byAttribute.get(spec.key) ?? 0) + 1);
          }
        }
        if (source.basis === "conflict" && conflicts.length < 40)
          conflicts.push(
            `  ${doc.name} | ${spec.label} = ${claim.raw ?? claim.value} | ${claim.evidence ?? "no quote"}`,
          );
      }
    }
  }

  console.log(
    `Numeric claims: ${numericClaims} in ${numericSpecs} attribute(s) of ${loaded.length} system(s).`,
  );
  console.log("By source-unit basis:");
  for (const b of BASES) console.log(`  ${b}: ${counts.get(b) ?? 0}`);
  console.log(
    `Read through the attribute's unit only (basis unknown or extractor_unverified, attribute has a unit): ${viaAttributeUnit}`,
  );
  console.log(
    "  by attribute:",
    [...byAttribute.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ") || "none",
  );
  console.log("\nWhat step B does with them (unit-policy.ts):");
  for (const st of [
    "evidenced",
    "declared",
    "not_needed",
    "unverified",
    "unknown",
    "conflict",
  ] as const)
    console.log(`  ${st}: ${standings.get(st) ?? 0}`);
  const held = [...heldByAttribute.values()].reduce((a, b) => a + b, 0);
  console.log(`Held back from consensus ("unit unknown"): ${held}`);
  for (const [key, n] of [...heldByAttribute.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${key}: ${n}`);
    for (const line of examples.get(key) ?? []) console.log(line);
  }
  console.log(
    "\nNote: extractor_unverified and conflict need a stored extractor unit (sourceUnit). Claims written\n" +
      "before that field existed have none, so those two stay at zero for them; a claim whose text states\n" +
      "a unit other than the attribute's (nautical miles under a km attribute) is evidenced and is\n" +
      "converted, not a conflict.",
  );
  if (conflicts.length) {
    console.log("Conflicts (extractor unit disagrees with the value text or quote):");
    for (const line of conflicts) console.log(line);
  }
  console.log("\nDry run. Nothing written.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
