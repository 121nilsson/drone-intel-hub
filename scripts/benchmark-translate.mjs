// Answers "should we add a separate translate model?" by measuring both paths on the same
// Cyrillic inputs: direct multilingual extraction vs translate-then-extract.
//
//   node scripts/benchmark-translate.mjs [--out=file.json]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const BASE = env.NVIDIA_BASE_URL.replace(/\/$/, "");

const EXTRACTOR = args.extractor ?? "nvidia/nemotron-3-super-120b-a12b";
const TRANSLATOR = args.translator ?? "nvidia/riva-translate-4b-instruct-v2";

const EXTRACT_SYS = `You are a defense technical intelligence analyst. Extract drone system data from raw reports.
Reply in json with keys: name (string|null), aliases (string[]), domain ("Air"|"Land"|"Sea"|"Multi"|null), origin (ISO2|null), operators (ISO2[]), propulsion (string|null),
specs (array of {key: snake_case, label, value: number|string, unit|null}), rfBands (string[]), systems (array of {name, matchId: catalog id|null, variantOf: catalog id|null}) listing EVERY drone system mentioned,
matchId (id from catalog or null), confidence (0..1), rationale (short).`;

const CATALOG = ["shahed-136: Shahed-136 / Shahed-136", "lancet-3: Lancet-3 / Lancet-3", "gweepard: Gepard AA / Gepard AA"].join("\n");

const SAMPLES = [
  {
    id: "ru-attack",
    ru: "ВСУ сообщили, что ударные БПЛА «Шахед-136» атаковали Одессу. На перехвате работали зенитные комплексы ПВО.",
    terms: ["Shahed", "Odesa"],
  },
  {
    id: "ru-variant",
    ru: "По данным разведки, Lancet-3 является обновлённым вариантом Lancet-2 с новой оптико-электроннойpayload.",
    terms: ["Lancet"],
  },
  {
    id: "ru-specs",
    ru: "Дальность полёта БПЛА достигает 2000 км, скорость — 185 км/ч. Применяется оптоволоконное управление.",
    terms: ["2000", "185"],
  },
];

async function chat(model, messages, json, timeout = 75_000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      signal: ac.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.NVIDIA_API_KEY}` },
      body: JSON.stringify({ model, messages, ...(json ? { response_format: { type: "json_object" } } : {}) }),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, ms: performance.now() - t0, error: text.replace(/\s+/g, " ").slice(0, 120) };
    const j = JSON.parse(text);
    const msg = j.choices?.[0]?.message ?? {};
    return { ok: true, ms: performance.now() - t0, content: msg.content ?? msg.reasoning_content ?? "" };
  } catch (e) {
    return { ok: false, ms: performance.now() - t0, error: e.name === "AbortError" ? "timeout" : String(e.message).slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

const med = (a) => (a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
const rows = [];

for (const s of SAMPLES) {
  // Path A: hand the Cyrillic straight to the extractor.
  const direct = await chat(EXTRACTOR, [
    { role: "system", content: EXTRACT_SYS },
    { role: "user", content: `Catalog:\n${CATALOG}\n\nReport:\n${s.ru}` },
  ], true);

  // Path B: translate first, then extract the English.
  const tr = await chat(TRANSLATOR, [
    { role: "system", content: "Translate the user's message to English. Preserve technical terms, model names and numbers. Output only the translation." },
    { role: "user", content: s.ru },
  ], false);
  const translated = tr.ok ? tr.content.trim() : "";

  const after = translated
    ? await chat(EXTRACTOR, [
        { role: "system", content: EXTRACT_SYS },
        { role: "user", content: `Catalog:\n${CATALOG}\n\nReport:\n${translated}` },
      ], true)
    : { ok: false, ms: 0, error: "translate failed" };

  const keptTerms = (t) => t.filter((term) => translated.toLowerCase().includes(term.toLowerCase()));
  rows.push({
    id: s.id,
    direct_ms: Math.round(direct.ms),
    direct_ok: direct.ok,
    direct_has_cyrillic: direct.ok ? /[\u0400-\u04FF]/.test(direct.content) : null,
    translate_ms: Math.round(tr.ms),
    translate_ok: tr.ok,
    translation: translated.slice(0, 220),
    terms_kept: keptTerms(s.terms),
    terms_total: s.terms.length,
    pipeline_ms: Math.round(tr.ms + after.ms),
    extract_after_ok: after.ok,
  });

  const r = rows[rows.length - 1];
  console.log(`\n--- ${s.id}`);
  console.log(`  direct extract : ${Math.round(direct.ms)}ms  ok=${direct.ok}`);
  console.log(`  translate      : ${Math.round(tr.ms)}ms  ok=${tr.ok}  kept ${r.terms_kept.length}/${r.terms_total} terms`);
  console.log(`  translated     : ${JSON.stringify(translated.slice(0, 150))}`);
  console.log(`  extract after  : ${Math.round(after.ms)}ms  ok=${after.ok}`);
  console.log(`  pipeline total : ${r.pipeline_ms}ms  vs direct ${r.direct_ms}ms`);
}

const directMed = med(rows.map((r) => r.direct_ms));
const pipeMed = med(rows.map((r) => r.pipeline_ms));
const termKeep = rows.reduce((a, r) => a + r.terms_kept.length, 0) / rows.reduce((a, r) => a + r.terms_total, 0);

console.log("\n=== VERDICT INPUTS ===");
console.log("direct extraction median :", Math.round(directMed), "ms");
console.log("translate+extract median  :", Math.round(pipeMed), "ms");
console.log("term retention via translate:", `${Math.round(termKeep * 100)}%`);
writeFileSync(args.out ?? resolve(ROOT, "scripts", "translate-results.json"), JSON.stringify(rows, null, 2));