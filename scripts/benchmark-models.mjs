// Benchmarks NVIDIA NIM models against the app's real extraction prompt.
// Reads the key from .env.local; never prints it.
//
//   node scripts/benchmark-models.mjs [--models=a,b] [--repeats=N] [--out=file.json]
//
// Emits JSON so results can be turned into modelbenchmark.md without re-running.

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
const TIMEOUT_MS = Number(args.timeout ?? 75_000);

// --- verbatim from src/shared/infra/openai-compatible-ai.ts --------------------
const EXTRACT_SYS = `You are a defense technical intelligence analyst. Extract drone system data from raw reports.
Reply in json with keys: name (string|null), aliases (string[]), domain ("Air"|"Land"|"Sea"|"Multi"|null), origin (ISO2|null), operators (ISO2[]), propulsion (string|null),
specs (array of {key: snake_case, label, value: number|string, unit|null}) — include ANY novel attribute (e.g. jammers count, fiber spool length),
rfBands (string[]), systems (array of {name, matchId: catalog id|null, variantOf: catalog id|null}) listing EVERY drone system mentioned (e.g. attacker and interceptor),
matchId (id from catalog or null), confidence (0..1), rationale (short).
Only match a catalog id when the name matches exactly; a different variant number (Geran-5 vs Geran-2) is a NEW system with variantOf set.
If a price/unit cost appears, add spec {key:"unit_cost", label:"Unit Cost / Price", value:"$15,000 - $20,000"}.`;

const REQUIRED = ["name", "aliases", "domain", "origin", "operators", "propulsion", "specs", "rfBands", "systems", "matchId", "confidence", "rationale"];

const CATALOG = [
  ["shahed-136", "Shahed-136 / Shahed-136"],
  ["geran-2", "Geran-2 / Geran-2"],
  ["lancet-3", "Lancet-3 / Lancet-3"],
  ["gweepard", "Gepard AA / Gepard AA"],
  ["orlan-10", "Orlan-10 / Orlan-10"],
]
  .map(([id, label]) => `${id}: ${label}`)
  .join("\n");

const SUMMARY_SYS = "Write a terse 4-6 sentence executive intelligence summary of weekly drone technology shifts. No preamble.";

// --- test cases ------------------------------------------------------------------
// expected.match: the catalog id we want, or null when nothing should match.
const CASES = [
  {
    id: "named-system",
    label: "Two known systems named (English)",
    prompt:
      "Ukraine reported that Shahed-136 drones attacked Odesa overnight while a Gepard AA " +
      "interceptor battery was deployed alongside them to protect the city.",
    expected: { match: "shahed-136", systems: ["shahed-136", "gweepard"] },
  },
  {
    id: "variant",
    label: "Variant relationship",
    prompt:
      "Photo analysis confirms Lancet-3 is now fielded. Engineers describe it as an updated " +
      "variant of the Lancet-2 airframe with a new optics payload.",
    expected: { match: "lancet-3", systems: ["lancet-3"] },
  },
  {
    id: "cyrillic",
    label: "Cyrillic source (Russian-language post)",
    prompt:
      "ВСУ сообщили, что ударные БПЛА «Шахед-136» атаковали Одессу. На перехвате работали " +
      "зенитные комплексы. Потери противника оцениваются в 30 единиц техники.",
    expected: { match: "shahed-136", systems: ["shahed-136"] },
  },
  {
    id: "negative",
    label: "No drone present (must not match)",
    prompt:
      "The Pentagon named four directed-energy weapons for future counter-drone tasks, and " +
      "the US Army will begin fielding the improved M8 rifle in December.",
    expected: { match: null, systems: [] },
  },
];

const SUMMARY_INPUT = `Window: last 7 days. New systems: Lancet-3, Orlan-10. Notable changes: Lancet-3 gained a new EO payload; Orlan-10 range extended to 90 km. RF: several reports note fiber-optic tethering on FPV drones.`;

const MODELS = (args.models ??
  "google/gemma-3-4b-it,google/gemma-3-12b-it,nvidia/nemotron-nano-3-30b-a3b," +
  "nv-mistralai/mistral-nemo-12b-instruct,openai/gpt-oss-20b," +
  "nvidia/nemotron-3.5-lightning-30b-a3b,nvidia/nemotron-3-super-120b-a12b," +
  "meta/muse-glimmer-30b,z-ai/glm-5.3-flash,deepseek-ai/deepseek-v4.1-flash").split(",");

async function call(model, messages, json) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      signal: ac.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.NVIDIA_API_KEY}` },
      body: JSON.stringify({
        model,
        messages,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    const text = await res.text();
    const ms = performance.now() - t0;
    if (!res.ok) return { ok: false, status: res.status, ms, error: text.replace(/\s+/g, " ").slice(0, 120) };
    const j = JSON.parse(text);
    const msg = j.choices?.[0]?.message ?? {};
    const content = msg.content ?? msg.reasoning_content ?? "";
    return {
      ok: true,
      ms,
      content,
      reasoning: (msg.reasoning_content ?? "").length,
      finish: j.choices?.[0]?.finish_reason,
      usage: j.usage ?? null,
    };
  } catch (e) {
    return { ok: false, ms: performance.now() - t0, error: e.name === "AbortError" ? "timeout" : String(e.message).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

/** Same parsing the app performs, so a pass here means a pass in production. */
function grade(r, testCase) {
  if (!r.ok) return { passed: false, why: r.error ?? `http ${r.status}` };
  let parsed;
  try {
    parsed = JSON.parse(r.content.replace(/^```json|```$/g, "").trim());
  } catch {
    return { passed: false, why: "unparseable JSON" };
  }
  const missing = REQUIRED.filter((k) => !(k in parsed));
  if (missing.length) return { passed: false, why: `missing keys: ${missing.join(",")}` };
  const gotMatch = parsed.matchId ?? null;
  if (gotMatch !== testCase.expected.match) {
    return { passed: false, why: `matchId ${JSON.stringify(gotMatch)} != ${JSON.stringify(testCase.expected.match)}`, parsed };
  }
  const named = (parsed.systems ?? []).map((s) => s.matchId).filter(Boolean);
  const missed = testCase.expected.systems.filter((id) => !named.includes(id));
  if (missed.length) return { passed: false, why: `systems missed: ${missed.join(",")}`, parsed };
  return { passed: true, why: "ok", parsed, named };
}

const results = [];
for (const model of MODELS) {
  const row = { model, cases: [], summary: null, errors: 0 };
  for (const c of CASES) {
    const r = await call(model, [
      { role: "system", content: EXTRACT_SYS },
      { role: "user", content: `Catalog:\n${CATALOG}\n\nReport:\n${c.prompt}` },
    ], true);
    const g = grade(r, c);
    row.cases.push({
      case: c.id,
      ms: Math.round(r.ms),
      ok: r.ok,
      passed: g.passed,
      why: g.why,
      reasoning_chars: r.reasoning ?? 0,
      completion_tokens: r.usage?.completion_tokens ?? null,
      total_tokens: r.usage?.total_tokens ?? null,
    });
    if (!r.ok) row.errors++;
  }

  // tier2 use case: free-text briefing summary.
  const s = await call(model, [
    { role: "system", content: SUMMARY_SYS },
    { role: "user", content: SUMMARY_INPUT },
  ], false);
  row.summary = {
    ms: Math.round(s.ms),
    ok: s.ok,
    chars: s.ok ? s.content.length : 0,
    sentences: s.ok ? (s.content.match(/[.!?](\s|$)/g) ?? []).length : 0,
    reasoning_chars: s.reasoning ?? 0,
    error: s.error ?? null,
  };

  const lat = row.cases.filter((c) => c.ok).map((c) => c.ms).sort((a, b) => a - b);
  row.median_ms = lat.length ? lat[Math.floor(lat.length / 2)] : null;
  row.passed = row.cases.filter((c) => c.passed).length;
  results.push(row);
  console.log(
    `${model.padEnd(44)} ${row.passed}/${CASES.length}  median ${row.median_ms ?? "-"}ms  summary ${row.summary.ms}ms  reason ~${Math.max(...row.cases.map((c) => c.reasoning_chars))} chars`,
  );
}

writeFileSync(args.out ?? resolve(ROOT, "scripts", "benchmark-results.json"), JSON.stringify(results, null, 2));
console.log("\nwrote results JSON");