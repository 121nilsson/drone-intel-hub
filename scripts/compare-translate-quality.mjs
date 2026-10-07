// Grades direct-multilingual extraction against translate-then-extract on the same
// Cyrillic inputs, so the recommendation rests on measured output, not just latency.
//
//   node scripts/compare-translate-quality.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const BASE = env.NVIDIA_BASE_URL.replace(/\/$/, "");
const EXTRACTOR = "nvidia/nemotron-3-super-120b-a12b";
const TRANSLATOR = "nvidia/riva-translate-4b-instruct-v2";

const EXTRACT_SYS = `You are a defense technical intelligence analyst. Extract drone system data from raw reports.
Reply in json with keys: name (string|null), aliases (string[]), domain ("Air"|"Land"|"Sea"|"Multi"|null), origin (ISO2|null), operators (ISO2[]), propulsion (string|null),
specs (array of {key: snake_case, label, value: number|string, unit|null}), rfBands (string[]), systems (array of {name, matchId: catalog id|null, variantOf: catalog id|null}) listing EVERY drone system mentioned,
matchId (id from catalog or null), confidence (0..1), rationale (short).`;

const CATALOG = ["shahed-136: Shahed-136 / Shahed-136", "lancet-3: Lancet-3 / Lancet-3", "gweepard: Gepard AA / Gepard AA"].join("\n");

const SAMPLES = [
  { id: "ru-attack", ru: "ВСУ сообщили, что ударные БПЛА «Шахед-136» атаковали Одессу.", expect: "shahed-136", term: "2000" },
  { id: "ru-variant", ru: "Lancet-3 является обновлённым вариантом Lancet-2 с новой оптико-электронной payload.", expect: "lancet-3", term: "Lancet-2" },
  { id: "ru-specs", ru: "Дальность полёта БПЛА достигает 2000 км, скорость — 185 км/ч. Применяется оптоволоконное управление.", expect: null, term: "2000" },
];

async function chat(model, messages, json, timeout = 90_000) {
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
    if (!res.ok) return { ok: false, ms: performance.now() - t0, error: text.replace(/\s+/g, " ").slice(0, 100) };
    const j = JSON.parse(text);
    const m = j.choices?.[0]?.message ?? {};
    return { ok: true, ms: performance.now() - t0, content: m.content ?? m.reasoning_content ?? "" };
  } catch (e) {
    return { ok: false, ms: performance.now() - t0, error: e.name === "AbortError" ? "timeout" : String(e.message).slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

const grade = (r, expectMatch, term) => {
  if (!r.ok) return { verdict: "ERROR", detail: r.error };
  let p;
  try { p = JSON.parse(r.content.replace(/^```json|```$/g, "").trim()); }
  catch { return { verdict: "BADJSON", detail: r.content.slice(0, 60) }; }
  const match = p.matchId ?? null;
  const matchOk = match === expectMatch;
  const termOk = !term || (r.content.match(/2000|185/) !== null || true);
  // Did the numeric spec survive into structured output?
  const specs = JSON.stringify(p.specs ?? []);
  const numericOk = !term || /\d/.test(specs);
  return { verdict: matchOk ? "OK" : "WRONGMATCH", detail: `matchId=${match} numericSpecs=${numericOk}`, specs: (p.specs ?? []).length, conf: p.confidence };
};

for (const s of SAMPLES) {
  const direct = await chat(EXTRACTOR, [
    { role: "system", content: EXTRACT_SYS },
    { role: "user", content: `Catalog:\n${CATALOG}\n\nReport:\n${s.ru}` },
  ], true);
  const tr = await chat(TRANSLATOR, [
    { role: "system", content: "Translate to English. Preserve technical terms, model names and numbers. Output only the translation." },
    { role: "user", content: s.ru },
  ], false);
  const translated = tr.ok ? tr.content.trim() : "";
  const after = translated
    ? await chat(EXTRACTOR, [
        { role: "system", content: EXTRACT_SYS },
        { role: "user", content: `Catalog:\n${CATALOG}\n\nReport:\n${translated}` },
      ], true)
    : { ok: false, ms: 0, error: "translate failed", content: "" };

  const gd = grade(direct, s.expect, s.term);
  const ga = grade(after, s.expect, s.term);
  console.log(`\n--- ${s.id}  (expected matchId: ${s.expect})`);
  console.log(`  DIRECT  ${Math.round(direct.ms).toString().padStart(6)}ms  ${gd.verdict.padEnd(11)} ${gd.detail ?? ""}`);
  console.log(`  VIA TR  ${Math.round(tr.ms + after.ms).toString().padStart(6)}ms  ${ga.verdict.padEnd(11)} ${ga.detail ?? ""}   (translate ${Math.round(tr.ms)}ms)`);
  if (translated) console.log(`  translation: ${JSON.stringify(translated.slice(0, 130))}`);
}