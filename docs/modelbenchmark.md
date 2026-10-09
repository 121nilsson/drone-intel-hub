# NVIDIA NIM Model Benchmark

Measured against the free-tier endpoint (`https://integrate.api.nvidia.com/v1`) with the
key from `.env.local`. All numbers are wall-clock from a single account on a residential
connection, so treat them as relative, not absolute.

Reproduce with:

```bash
node scripts/probe-availability.mjs      # which models this key can actually call
node scripts/benchmark-models.mjs        # latency + precision on the real extraction prompt
node scripts/benchmark-translate.mjs     # direct multilingual vs translate-then-extract
node scripts/compare-translate-quality.mjs
```

The benchmark uses the **verbatim** `EXTRACT_SYS` prompt from
`src/shared/infra/openai-compatible-ai.ts` and the same JSON parsing the app performs, so a
pass here means a pass in production.

---

## 1. Headline finding: GET /models lies

`GET /models` lists **80** models. Only **13** can actually be invoked with this key.

| Outcome | Count | Meaning |
| --- | --- | --- |
| 200 OK | 13 | genuinely callable |
| 404 "Function ... Not found for account" | 55 | listed but not deployed for this account |
| timeout at 30s | 8 | endpoint accepted it, no response (incl. `z-ai/glm-5.3*`) |
| 400 | 1 | wrong request shape for that model (`nemotron-parse`) |
| 503 ResourceExhausted | 1 | transient capacity |

This is the single most useful result here: any model picker built on `GET /models` will
offer 55 models that fail at runtime. Probe with a real completion, not the catalogue.

The 13 callable models, ordered by trivial-request latency:

| Latency | Model | Reasoning? | Notes |
| --- | --- | --- | --- |
| 154ms | `nvidia/nemotron-parse-2.0` | no | document parsing, not instruction-following |
| 281ms | `nvidia/riva-translate-4b-instruct-v2` | no | translation |
| 304ms | `meta/llama-3.2-11b-vision-instruct` | no | see precision table - fails schema |
| 349ms | `nvidia/nemotron-3.5-content-safety` | no | classifier |
| 421ms | `openai/gpt-oss-20b` | yes | 2/4 on precision |
| 438ms | `nvidia/nemotron-3-super-120b-a12b` | yes | **4/4 - recommended** |
| 473ms | `google/diffusiongemma-26b-a4b-it` | no | rejects `response_format` |
| 513ms | `nvidia/nemotron-3.5-lightning-30b-a3b` | yes | current tier 1 - see below |
| 514ms | `nvidia/ising-calibration-1.5-31b` | no | Monte Carlo solver, poor extraction |
| 620ms | `meta/muse-glimmer-30b` | yes | current tier 2 |
| 1376ms | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | yes | omni, 2/4 |
| 3620ms | `nvidia/nemotron-3-ultra-550b-a55b` | yes | 4/4 but slowest general model |
| 15.7s | `meta/llama-3.2-90b-vision-instruct` | no | unusably slow |

Note the trap: the trivial "reply ok" latency ranks models almost opposite to their real
latency on a long extraction. `nemotron-3.5-lightning` answers "ok" in 513ms but takes
**45-75s** on the actual prompt, because its reasoning output balloons to ~14k characters.
Latency must be measured on the real workload.

---

## 2. Precision and speed on the real extraction prompt

Four cases: two known systems named, a variant relationship, a Cyrillic-language post, and
a negative (no drone present, must not match). "Reasoning" is characters of
`reasoning_content` generated - a good proxy for latency and token cost.

| Model | Passed | Median | Summary | Reasoning | Verdict |
| --- | --- | --- | --- | --- | --- |
| **`nvidia/nemotron-3-super-120b-a12b`** | **4/4** (3/4 on rerun) | **6.6-13.6s** | 1.7-4.4s | ~4.6k | best balance |
| `meta/muse-glimmer-30b` | 4/4 | 35.2s | 13.6s | ~5.2k | accurate, ~5x slower |
| `nvidia/nemotron-3-ultra-550b-a55b` | 4/4 | 47.0s | 15.6s | ~8.6k | accurate, slowest |
| `nvidia/nemotron-3.5-lightning-30b-a3b` | 2/4 | 45.3s | 16.6s | ~14k | **current tier 1 - poor** |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | 2/4 | 31.9s | 4.6s | ~8.9k | misses systems |
| `openai/gpt-oss-20b` | 2/4 | 24.9s | 5.2s | ~6.2k | misses `matchId` |
| `nvidia/ising-calibration-1.5-31b` | 2/4 | 11.9s | 3.1s | 0 | picks wrong id, false positives |
| `meta/llama-3.2-11b-vision-instruct` | 0/4 | 33.6s | 3.7s | 0 | ignores the schema |
| `google/diffusiongemma-26b-a4b-it` | 0/4 | - | 1.2s | 0 | rejects `response_format` |

### Failure modes worth knowing

**`nemotron-3.5-lightning` (current tier 1) timed out on 2 of 4 cases at a 75s budget.**
It is both the slowest and among the least accurate. This is the direct cause of the
multi-minute per-post ingest observed earlier.

**`meta/llama-3.2-11b-vision-instruct` is 0/4 not because of intelligence but because of
formatting.** It returns valid JSON missing 8 of the 12 required keys. Any model picker that
skips a schema check will accept garbage from it.

**`google/diffusiongemma-26b-a4b-it` rejects `response_format: json_object` outright.** The
app always sends it, so this model is incompatible without a code path change.

**Precision is bimodal, not smooth.** The good models either follow the schema and match
correctly, or they fail loudly. There was no model that followed the schema but was subtly
wrong on the Cyrillic case except `ising-calibration`, which false-positived on the negative.

### Stability caveat

Single samples are noisy. `nemotron-3-super-120b-a12b` scored 4/4, 3/4, 4/4 across three
runs with medians of 6.6s, 13.6s, 11.5s - the spread is provider load, not the model. Treat
any single number as ±2x.

---

## 3. Recommendation

**Set tier 1 to `nvidia/nemotron-3-super-120b-a12b`.** It matches the incumbent's precision
while being 3-7x faster, and it is the only model that was both fully accurate and fast.

**Set tier 2 to `meta/muse-glimmer-30b`,** which is what you have now. It is accurate and
its slower reasoning is genuinely useful for escalation, where quality matters more than
latency and few posts reach tier 2.

In other words: invert the current assignment. The cheap screening tier is doing the
expensive model's job at worse latency, and escalation is not being used as the specialist
step it exists for.

Do **not** switch to `nemotron-3-ultra-550b-a55b` despite it being the largest model: same
4/4 precision as `nemotron-3-super-120b-a12b` at ~7x the latency.

Because only 13 models are callable and that set can change with account entitlements, treat
the model choice as configuration and keep it in `.env.local` rather than in code.

---

## 4. Should we add a separate translation model?

**Yes - `nvidia/riva-translate-4b-instruct-v2` is cheap enough to be worth it, and it
stabilises the slowest part of the pipeline.** The old `nvidia/riva-translate-4b-instruct`
is *not* callable (404); only `-v2` is.

Same three Cyrillic inputs, two paths:

| Case | Direct (Cyrillic -> extractor) | Translate first | Better |
| --- | --- | --- | --- |
| ru-attack | 8.7s, `matchId=shahed-136` correct | 13.2s (1.0s translate), correct | direct |
| ru-variant | 17.0s, `matchId=lancet-3` correct | 12.4s (1.0s translate), correct | translate |
| ru-specs (no model named) | 7.7s, **`matchId=shahed-136` - false positive** | 6.2s (1.0s translate), correctly `null` | translate |

Separate run, same inputs:

| Case | Direct | Translate first |
| --- | --- | --- |
| ru-attack | 8.3s | 7.1s |
| ru-variant | 14.9s | 15.4s |
| ru-specs | **56.9s** | **5.8s** |

Translation itself costs ~1.0s and retained 4/5 key terms across samples (Shahed, Lancet-2,
2000, 185 km/h all preserved).

### The real argument is variance, not the median

Direct Cyrillic extraction ranged from 7.7s to **56.9s** across identical inputs. The model
spends far more reasoning tokens when it has to decode Cyrillic first. Normalising the input
with a ~1s model removes that variance: every translate-then-extract run landed between 5.8s
and 15.4s.

That matters because the auto-ingest job loops over up to 20 posts per source. Direct
extraction means occasional 57s outliers that stretch a sync pass into minutes; the
translate path keeps each post bounded.

### Caveats before adopting it

**It is a lossy hop.** One sample lost a term ("Odesa" -> "Odessa"), and overall term
retention was 80%. Proper nouns are exactly what catalog matching depends on, so this
tradeoff is real.

**It adds a failure point.** Two network calls instead of one, so double the exposure to
timeouts and provider errors.

**It should be conditional, not mandatory.** Only pre-translate when the text is detected as
non-Latin script, and skip it otherwise - that keeps English posts on the fast single-call
path. Best-effort with fallback to direct extraction if the translate step fails.

**Arabic is unmeasured.** The app's `DRONE_HINT` includes Arabic (مسيّرة), so Arabic sources
are expected, but only Russian was tested here.

---

## 5. What each usable model is actually good for

Only 13 are callable, and most are not general-purpose:

- **`nvidia/riva-translate-4b-instruct-v2`** - translation, ~1s. The one clearly
  purpose-built model worth adding.
- **`nvidia/nemotron-parse-2.0`** - fastest at 154ms, but built for document parsing, not
  instruction following.
- **`nvidia/nemotron-3.5-content-safety`** - a classifier, not an extractor. The rest of
  the RAG/safety family (`llama3-chatqa`, `nemoguard`, `nemotron-3.5-content-safety` peers)
  are 404 for this account, so they are not options at all.
- **`nvidia/ising-calibration-1.5-31b`** - Monte Carlo calibration. Solved the variant case
  but false-positived on the negative, so not usable for extraction despite being fast.
- **`google/diffusiongemma-26b-a4b-it`**, **`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`** - vision
  and omni models. Both failed this text-only schema task.
- **`nvidia/nemotron-3-super-120b-a12b`**, **`meta/muse-glimmer-30b`**,
  **`nvidia/nemotron-3-ultra-550b-a55b`** - the only three general models that handled the
  extraction schema correctly.

With 55 of 80 models unavailable, free-tier coverage of general instruction-following is
thin. The tier1/tier2 pair above is essentially the whole viable menu, which is worth knowing
before designing around any particular model.

---

## 6. Open questions

- **Is `nemotron-3-super-120b-a12b` reliably faster under sustained load?** Single samples
  only. A proper test would run each candidate across 50 posts and compare p50/p95.
- **Does Arabic extraction work as well as Cyrillic?** Untested.
- **Rate limits are unknown.** One probe hit `503 ResourceExhausted` mid-run. The
  auto-ingest loop runs sequentially today, which is probably right, but the ceiling is
  undocumented.
- **Cost.** Free-tier NIM does not publish per-token pricing in the API, so the token counts
  in `scripts/benchmark-results.json` are the only cost proxy available.