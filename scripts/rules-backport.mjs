#!/usr/bin/env node
/**
 * Lists dynamic rules that have been live long enough to belong in the TypeScript lexicons, as
 * a Markdown checklist of the exact edits. Read-only: the system never edits TS code or git
 * (EVALUATION_AUTOMATION §3 princip 1) - a human makes the edit, then quarantines the rule once
 * the static lexicon covers it.
 *
 *   DATABASE_URL=postgres://... node scripts/rules-backport.mjs [--days 14]
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const at = process.argv.indexOf("--days");
const days = at > 0 ? Number(process.argv[at + 1]) : 14;

/** Where each rule kind lands in the static engine. */
const TARGET = {
  add_stopword: (p) => `heuristics/names.ts STOP: add "${p.word ?? (p.terms ?? []).join('", "')}"`,
  add_alias: (p) => `drone catalog: add alias "${p.alias}" to ${p.droneId ?? p.targetDroneId}`,
  add_cue: (p, lang) =>
    `lexicons/${lang === "all" ? "<lang>" : lang}.ts cues → the list feeding "${p.target}": ${(p.terms ?? []).map((t) => `"${t}"`).join(", ")}${p.stem ? ` (stem "${p.stem}")` : ""}`,
  context_filter: (p) =>
    `extractors owning "${p.key}": ${p.action === "reroute" ? `route to "${p.targetKey}"` : "notAfter guard"} when preceded by ${(p.triggerWords ?? []).map((t) => `"${t}"`).join(", ")}`,
  add_unit_scale: (p) => `lexicons money.magnitudes: "${p.unit}" = ${p.multiplier}`,
};

const sql = postgres(url, { max: 1, prepare: false });
try {
  const rows = await sql`
    select id, kind, language, payload, origin, promoted_at
    from dynamic_rules
    where status = 'active' and promoted_at < now() - (${days}::int * interval '1 day')
    order by kind, promoted_at`;
  if (!rows.length) {
    console.log(`No rule has been active for more than ${days} days.`);
  } else {
    console.log(`# Rules active > ${days} days - candidates for the static lexicons\n`);
    for (const r of rows) {
      const describe = TARGET[r.kind] ?? (() => JSON.stringify(r.payload));
      console.log(
        `- [ ] \`${r.id}\` (${r.origin}, since ${r.promoted_at.toISOString().slice(0, 10)}): ${describe(r.payload, r.language)}`,
      );
    }
    console.log(
      "\nAfter the edit lands, quarantine the rule on /evaluation so it is not applied twice.",
    );
  }
} finally {
  await sql.end();
}
