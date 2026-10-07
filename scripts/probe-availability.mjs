// Probes which listed models are actually callable with this key, and how fast a trivial
// request is. GET /models lists things the account cannot necessarily invoke.
//
//   node scripts/probe-availability.mjs [--out=file.json]

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

// Small models first so the fast half of the sweep reports early.
const { data: listed } = await (await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${env.NVIDIA_API_KEY}` } })).json();
const ids = (listed ?? []).map((m) => m.id).filter(Boolean);

const probe = async (model) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      signal: ac.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.NVIDIA_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        max_tokens: 8,
      }),
    });
    const text = await res.text();
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) {
      let why = text.replace(/\s+/g, " ").slice(0, 90);
      try { why = JSON.parse(text).detail ?? JSON.parse(text).title ?? why; } catch {}
      return { model, available: false, status: res.status, ms, why };
    }
    const j = JSON.parse(text);
    return {
      model,
      available: true,
      status: res.status,
      ms,
      completion_tokens: j.usage?.completion_tokens ?? null,
      has_reasoning: !!j.choices?.[0]?.message?.reasoning_content,
    };
  } catch (e) {
    return { model, available: false, status: 0, ms: Math.round(performance.now() - t0), why: e.name === "AbortError" ? "timeout" : String(e.message).slice(0, 90) };
  } finally {
    clearTimeout(timer);
  }
};

const rows = [];
for (const id of ids) {
  const r = await probe(id);
  rows.push(r);
  console.log(
    `${r.available ? "OK  " : "FAIL"} ${r.status || "-"} ${String(r.ms).padStart(6)}ms ${id.padEnd(46)} ${r.available ? (r.has_reasoning ? "reasoning" : "") : r.why.slice(0, 60)}`,
  );
}

const ok = rows.filter((r) => r.available).sort((a, b) => a.ms - b.ms);
console.log(`\n${ok.length}/${rows.length} callable`);
console.log("fastest:", ok.slice(0, 8).map((r) => `${r.model} (${r.ms}ms)`).join(", "));
writeFileSync(args.out ?? resolve(ROOT, "scripts", "availability-results.json"), JSON.stringify(rows, null, 2));