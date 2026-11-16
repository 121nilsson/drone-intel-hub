/**
 * One-off backfill: keep what the second reader had said about audit items drawn before readings
 * were frozen at draw (migrations/026).
 *
 * Before 026 the audit read the reader's verdict live from the catalogue, so nothing says what the
 * reader had said when an item was drawn, and a reading cannot be shown to describe the claim as
 * it was drawn. Each item that has a current reading and no history row gets one with
 * phase 'backfill': kept, shown as legacy, and never counted as the reader's reading at draw. The
 * legacy verdict "unsupported" is stored as legacy_unsupported, not read as either contradicted
 * or not_found.
 *
 * Append-only: the table refuses UPDATE and DELETE, so a run can only add rows, and an item that
 * already has a history row is skipped. The default is a DRY RUN that only counts.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-audit-reader.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/backfill-audit-reader.ts --apply   # write
 */
const apply = process.argv.includes("--apply");

async function main() {
  // Imported here, not at the top: a *.server.ts module may only be loaded by a server entry.
  const { serverServices } = await import("@/shared/infra/server-services.server");
  const { readerRow } = await import("@/shared/infra/verification/audit-freeze.server");
  const { audit } = serverServices();
  const items = await audit.legacyItemsWithoutHistory();
  const droneIds = [...new Set(items.map((i) => i.drone_id))];
  const readings = new Map(
    droneIds.length
      ? (await audit.currentReadings(droneIds)).map((r) => [r.id, r.entailment] as const)
      : [],
  );
  const rows = items.flatMap((item) => {
    const entailment = readings.get(item.claim_id);
    return entailment
      ? [
          readerRow(item.id, entailment, "backfill", {
            postText: item.post_text ?? "",
            answeredAt: item.answered_at,
          }),
        ]
      : [];
  });
  const legacy = rows.filter((r) => r.verdict === "legacy_unsupported").length;
  console.log(
    `${items.length} audit item(s) without history; ${rows.length} have a reading to keep (${legacy} legacy "unsupported").`,
  );
  if (!apply) {
    console.log("Dry run: nothing written. Pass --apply to append the rows.");
    return;
  }
  // In slices: one statement per few hundred rows keeps the parameter count well under the limit.
  for (let i = 0; i < rows.length; i += 200) await audit.appendReaderRows(rows.slice(i, i + 200));
  // The draw never recorded what the reader had then: say so on the item, once, where it is unset.
  const ids = rows.map((r) => r.audit_id);
  if (ids.length) await audit.markReaderStateLegacy(ids);
  console.log(`Appended ${rows.length} row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
