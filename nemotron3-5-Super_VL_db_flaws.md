# Database & storage flaws connected to heuristics — drone-intel-hub

Reviewed: migrations 001–007, `postgres-store.server.ts`, `db.server.ts`, `store.functions.ts`,
`local-repository.ts`, `pipeline.ts`, `auto-ingest.ts`, `extraction-gates.ts`, `pricing.ts`,
`heuristic-ai.ts`, `numeric.ts`, `currency.ts`, `semantic.ts`, `units.ts`, `apply.ts`,
`store.ts` (contract), `dispatch/types.ts`, `source/types.ts`.

**Database state examined live** on `127.0.0.1:5435` (container `drone-intel-hub-db-1`, postgres:18.6)
on 2026-10-17. All findings below are backed by actual row counts and sampled values.

---

## Live data snapshot

| Table | Rows |
|-------|------|
| drones | 491 |
| candidates | 4,646 |
| dispatches | 3,170 (1,632 processed, 1,275 irrelevant, 247 duplicate, 16 pending) |
| sources | 91 |
| procurements | 0 |
| taxonomies | — |
| taxonomy_candidates | — |

**Dispatch outcomes** (processed only): auto-discarded 1,116 (68%), auto-merged 334 (20%),
queued 107 (7%), auto-promoted 75 (5%).

**Engine breakdown** (processed dispatches): `combined` 1,631, `heuristic` 1. When an AI
provider is available, the heuristic is almost never the final engine — it is overridden by AI
on nearly every dispatch.

**Pipeline version**: all 1,632 processed dispatches use `drone-osint-v5/2`.

---

## Flaw 1: Spec key explosion — 469 distinct keys, no canonical normalization

**Evidence:** Querying `drones.data->'specs'` across all 491 rows yields **469 distinct spec keys**.
Only 17 keys appear more than 10 times:

| Key | Count |
|-----|-------|
| range | 102 |
| speed | 55 |
| length | 48 |
| endurance | 37 |
| payload | 36 |
| wingspan | 35 |
| unit_cost | 32 |
| max_speed | 26 |
| service_ceiling | 20 |
| contract_value | 20 |
| guidance | 20 |
| weight_launch | 18 |
| engine | 17 |
| max_altitude | 15 |
| cruise_speed | 14 |
| warhead | 12 |
| height | 11 |

**Same concept, 5–10 different keys:**
- Range: `range`, `range_max`, `range_link`, `combat_range`, `combat_radius`, `operational_range`, `ferry_range`, `strike_range_high`, `strike_range_low`, `remote_control_range`, `detection_range`, `detection_range_micro_drone`, `detection_range_small_uav`, `engagement_range`, `ballistic_intercept_range`, `tbm_intercept_range`
- Speed: `speed`, `max_speed`, `cruise_speed`, `cruise_speed_min`, `speed_cruise`, `speed_max`, `speedMax`, `top_speed`, `dive_speed`
- Weight: `weight`, `weight_empty`, `weight_mtow`, `weight_launch`, `weight_gross`, `system_weight`, `systemWeight`, `total_mass`, `mass`
- Power: `power`, `engine_power`, `distributable_power`, `laser_power`
- Count: `jammers`, `cameras`, `missiles`, `engines`, `launchers`, `rotors`, `antennas`, `bombs`

**Same concept, different casing:** `engine` / `Engine`, `TRL` / `trl`, `maxSpeed` / `max_speed`,
`speedMax` / `speed_max`, `EO targeting station position` / `eo_ir_sensors`,
`contractValue` / `contract_value`, `warheadMass` / `warhead_mass`.

**Impact:** Consensus() cannot group equivalent specs. A drone with `range: 100 km` and another
with `combat_range: 100 km` are treated as having unrelated specs. Cross-source agreement is
invisible. Deduplication of claims fails because keys don't match.

**Root cause:** `semanticKeyFor()` in `semantic.ts` maps only a small subset of keys. The rest
fall through to `return key` (line 84), preserving whatever the extractor invented. Heuristic
extractors and the AI model both invent keys freely, and nothing canonicalizes them at ingest.

**Fix:** Extend `semanticKeyFor()` to cover the observed variants, or add a normalization pass
that maps variant keys to canonical semantic keys before writing to `drones.data`. The semantic
table already has mappings for `range.*`, `speed.*`, `weight.*`, `dimension.*`, `payload.*`,
`cost.unit`, `endurance.flight`, `guidance.system` — it just needs the long tail of observed
variants added.

---

## Flaw 2: Unit chaos — same dimension has 5–8 different unit strings

**Evidence:** Sample of units per key (from `drones.data->'specs'`):

| Key | Units observed | Count |
|-----|---------------|-------|
| endurance | h, min, hours, minutes, days, hour | 6 |
| speed | km/h, Mach, knots, mph, км/год, (blank) | 6 |
| range | km, nautical miles, км, NM, meters, mile | 6 |
| weight | kg, pounds, tonnes, lb, (blank) | 5 |
| wingspan | m, ft, м, mm | 4 |
| payload | kg, lb, кг | 3 |
| warhead | kg, g, кг | 3 |
| altitude | km, m, feet, ft | 4 |
| service_ceiling | m, ft | 2 |
| length | m, м | 2 |

**Language mixing in units:** `кг`, `км`, `м` (Cyrillic) appear alongside `kg`, `km`, `m`.
Currency units mixed: `USD`, `RUB`, `₽`, `фунтів стерлінга`, `фунтів стерлінгів`.

**Impact:** `canonicalUnitForSemantic()` in `semantic.ts` returns a target unit (km, kg, km/h,
min, W, m), but the raw `unit` field on specs is never canonicalized. `rebaseQuantity()` exists
in `units.ts` but is only called if `targetUnit` is set — and `targetUnit` is only set when
`semanticKeyFor()` recognizes the key (see Flaw 1). Unrecognized keys skip normalization entirely.

**Fix:** After resolving the semantic key, always run `normalizeQuantity()` + `rebaseQuantity()`
to canonicalize the unit, regardless of whether the key was in the semantic map. Store both the
original unit string and the canonical unit/value.

---

## Flaw 3: Money stored as opaque, unparseable strings

**Evidence:** `unit_cost` claim values sampled from live data (20 rows):

```
$1.50
100K
USD$30,000
$1000 (базова версія)
$302,000
US$55,000 t0 $75,000        <- typo: "t0" instead of "to"
$2.5 million
Export cost: 3 million rubles ($37,000)
~ 4 000$
US$10,000
8.5 million hryvnias ()
$200,000
way under $100,000
$193,000 (export; various estimates for domestic production cost range from $10,000 to $50,000)
$5,000
~ 15 тыс. долларов США (декабрь 2014)
$2,100
45.6 млн грн (оценка 2020 года)
$12 000
$500 (2026)
```

**Problems visible in the live data:**
- Mixed currencies: USD, UAH (hryvnias), RUB (rubles) — no currency code normalization
- Mixed formats: `"$1.50"` vs `"100K"` vs `"$2.5 million"` vs `"45.6 млн грн"`
- Typos: `"t0"` instead of `"to"` in ranges
- Parenthetical notes mixed in: `"(базова версія)"`, `"(оценка 2020 года)"`, `"(export; various estimates...)"`
- Approximate markers: `"~"`, `"way under"`
- Ranges: `"US$55,000 t0 $75,000"`
- None of these can be compared numerically, summed, or filtered

The `unit_cost` spec has **no value/unit at the spec level** — all 32 rows return NULL for both.
Values live only in `claims[].value` as raw strings.

`parseMagnitude()` in `numeric.ts` (line 38) only recognizes:
`k|K|thousand|тыс|тис|M|million|млн|млрд|billion|bn`

It misses: Ukrainian `мiльйон`/`мiльярд`, Swedish `miljoner`/`miljarder`, Polish `mln`/`mld`,
Turkish `bin`/`milyon`/`milyar`, and every future language's magnitude words.

**Impact:** `extractPrice()` returns strings. Consensus cannot compare prices across languages.
You cannot query "all units priced above $500,000" or "all contracts over $10 million."

**Fix:** Keep verbatim strings as primary stored value (for dossiers). Add `extractPriceNumeric()`
returning a normalized `Money` object (amount + currency + magnitude multiplier), wire
`money.magnitudes` from the lexicons into `parseMagnitude`, and only route numeric Money into
consensus after it proves stable. Consensus already works on strings — don't break it.

---

## Flaw 4: Non-measurement and financial fields stored as drone specs

**Evidence:** Keys observed in `drones.data->'specs'` that are not measurements:

**Descriptive/text fields:** `description`, `status`, `type`, `role`, `system_role`, `function`,
`purpose`, `mission`, `mission_type`, `mission_role`, `platform_type`, `technology`,
`software_type`, `supplier`, `origin`, `manufacturer`, `name`, `capability`, `effectiveness`,
`availability`, `readiness`, `form_factor`, `architecture`, `motor_type`, `propulsion_type`,
`sensor_type`, `camera_type`, `launch_mode`, `installation_type`, `communication_type`

**Financial/procurement fields (belong in `procurements` table, which has 0 rows):**
`contract_value` (20), `contract_value_france`, `contract_value_gbp`, `contract_value_usd`,
`development_cost`, `production_rate`, `production_volume`, `batch_funding`, `advance_funding`,
`total_cost`, `total_funding`, `operating_cost`, `package_cost`, `package_value`,
`sustainment_cost_savings_per_year`, `total_commitment`, `associated_investment`,
`delivery_amount_gbp`, `delivery_amount_usd`, `fast_track_value`, `orderValue`

**Impact:** The `drones.specs` array is polluted with non-spec data. Consensus treats a
`description` claim the same as a `range` claim. Financial data that should be in `procurements`
is trapped in drone JSONB and never queried as procurement data.

**Root cause:** The AI model and heuristic extractors emit whatever keys they want, and nothing
filters them at the `add()` boundary. `ExtractedSpecSchema` validation (which AI output passes)
is not applied to heuristic output.

**Fix:** Run heuristic specs through `ExtractedSpecSchema.parse()` (lenient) at the `add()`
boundary. Add a blocklist/allowlist for spec keys — non-measurement keys should be routed to
other fields (summary, notes, etc.) or dropped. Financial keys should be routed to the
procurements pipeline, not drone specs.

---

## Flaw 5: Procurements table is empty (0 rows)

**Evidence:** `SELECT count(*) FROM procurements` → 0. Yet `contract_value` appears 20 times in
drone specs, and `development_cost`, `production_rate`, `total_cost`, `batch_funding` etc. are
also present.

**Impact:** All contract/grant/procurement intelligence extracted from posts is trapped in drone
JSONB specs and never reaches the dedicated `procurements` table. The procurement extraction
path (`extractProcurement` in `pipeline.ts`) exists but is never populated.

**Fix:** Route financial/contract spec keys (`contract_value`, `development_cost`,
`production_rate`, `batch_funding`, etc.) through the procurement extraction path instead of
storing them as drone specs.

---

## Flaw 6: Almost zero pure heuristic usage (1631 combined vs 1 heuristic)

**Evidence:** All 1,632 processed dispatches use engine `combined` (AI + heuristic), only 1 uses
`heuristic` alone. This is because when `DATABASE_URL` is set and an AI provider key exists,
`services.tsx` wires `tier1` and `tier2` to `OpenAICompatibleExtractor`, and `heuristic`/`fallback`
to `HeuristicExtractor`. The heuristic runs first as a screen, but AI almost always refines it.

**Impact:** You cannot measure heuristic-only performance on live data — there's effectively none.
When the AI provider is down, `deferOnOutage: true` keeps posts pending rather than recording
heuristic results as final, so heuristic-only output is never written to the archive.

**Fix:** If you want to evaluate the heuristic engine in isolation, run a backfill with
`deferOnOutage: false` so heuristic results are recorded as final during outages, or add a
dedicated evaluation mode that runs heuristic-only on a sample of processed dispatches.

---

## Flaw 7: High auto-discard rate (67% of candidates discarded)

**Evidence:** 3,131 discarded / 4,646 total candidates (67%). 991 merged (21%), 297 promoted (6%),
227 pending (5%).

**Impact:** Two-thirds of all extraction candidates are thrown away. This could mean:
- The heuristic is over-detecting system names (false positives from `detectNames`)
- The auto-discard threshold is too aggressive
- Non-system names (organizations, outlets) are slipping through `notASystemName`

Without per-source breakdowns of discard reasons, it's impossible to tell whether the heuristic
is producing noise or the gates are too tight.

**Fix:** Add a `discard_reason` field to candidates so you can analyze *why* candidates are
discarded (below confidence threshold, org name, no specs, duplicate, etc.). Add per-source
discard rates to the Sources page health dashboard.

---

## Flaw 8: No numeric Money output from heuristics

**Evidence:** `pricing.ts` `extractPrice()` returns strings like `"$2 billion"`, `"$2.5 million"`,
`"45.6 млн грн"`. `parseMagnitude()` in `numeric.ts` misses most magnitude words across
languages. No `extractPriceNumeric()` exists.

**Impact:** Price data is opaque text at the database layer. Cross-language price comparison is
impossible. Consensus cannot merge `$2 billion` (EN) with `2 млрд` (RU) because they're
different strings.

**Fix:** Add `extractPriceNumeric()` that returns `{ amount, currency, raw, magnitudeMultiplier }`.
Wire `money.magnitudes` from each lexicon into `parseMagnitude`. Store both the verbatim string
and the normalized Money object.

---

## Flaw 9: Values stored in `claims[]`, not at spec level

**Evidence:** `unit_cost` has 32 rows but ALL return NULL for spec-level `value` and `unit`.
`range` has 102 rows but 0 rows with spec-level `value`/`unit`. The actual data lives in
`claims[].value` and `claims[].raw`.

**Impact:** Queries like `SELECT value FROM specs WHERE key = 'range'` return nothing. You must
unnest `claims` to read any measured value. This makes ad-hoc SQL analysis difficult and slow.

**Root cause:** The `ExtractedSpec` type has `value` at the top level, but the heuristic and AI
paths write raw strings into `claims[].value` instead of populating the spec-level `value` field.

**Fix:** Populate the spec-level `value` field (parsed number) and `unit` field at extraction
time, keeping `claims[].raw` as the verbatim evidence. This makes SQL queries practical.

---

## Flaw 10: No FK between dispatches and drones; provenance is JSONB-only

**Evidence:** `droneIds` and `candidateIds` on `RawDispatch` live only in the JSONB `data`
column. There is no `drone_id` column, no foreign key, no join table. When `removeDrone()`
is called (`pipeline.ts:1021–1024`), it iterates all dispatches in memory (O(n)) to strip the
reference — not a cascading FK in the database.

**Impact:** Orphaned references are possible. Provenance queries ("which dispatches contributed
specs to drone X?") require JSONB containment scans, not b-tree index lookups. The GIN index
on `data jsonb_path_ops` helps but is not the same as a real column index.

**Fix:** Mirror `drone_ids` as a `text[]` column with a GIN index, and consider a join table
`dispatch_drone_links(dispatch_id, drone_id)` for proper referential integrity with cascading
deletes.

---

## Flaw 11: `content_hash` has no backfill

**Evidence:** Migration 006 adds `content_hash text` nullable, no NOT NULL, no backfill.
Documents stored before this migration carry no fingerprint. They are supposedly fingerprinted
"lazily on read" (`LocalDispatchRepository`), but if a dispatch is beyond the 3,000-row cap or
never read, it is never fingerprinted.

**Impact:** Pre-migration duplicates can be collected and extracted multiple times, inflating
spec claim counts in consensus (one fact counted N times across N copies of the same story).

**Fix:** Add a one-time backfill migration that computes `simHash64(text)` for all dispatches
where `content_hash IS NULL AND text IS NOT NULL AND text <> ''`.

---

## Flaw 12: `CloudStore` does not exist

**Evidence:** `store.functions.ts:19–23` imports `../cloud/cloud-store.server`, but no such file
exists in `src/shared/infra/storage/`. Without `DATABASE_URL` and without Supabase env vars,
`store()` throws at runtime on first data access.

**Impact:** Self-hosted deployments without `DATABASE_URL` crash on first data access. The app
has no working storage backend in that configuration.

**Fix:** Implement `CloudStore`, or fall back to `LocalStorageStore` when neither PostgreSQL nor
Lovable Cloud is configured.

---

## Suggested priority order (based on live data evidence)

| Priority | Flaw | Evidence from live data | Effort |
|----------|------|------------------------|--------|
| 1 | Spec key explosion (469 keys) | 469 distinct keys, only 17 used >10x | Medium |
| 2 | Money as opaque strings | 20+ unparseable unit_cost formats | Medium |
| 3 | Unit chaos | 6+ unit strings per dimension | Medium |
| 4 | Non-measurement fields as specs | `description`, `status`, `type` as spec keys | Low |
| 5 | Procurements table empty | 0 rows, financial keys in drone specs | Medium |
| 6 | Values in claims[], not spec level | unit_cost/range have NULL spec-level value | Low |
| 7 | Schema validation on heuristic output | Heuristic bypasses ExtractedSpecSchema | Low |
| 8 | content_hash no backfill | Pre-migration dups not fingerprinted | Low |
| 9 | CloudStore missing | Import fails without DATABASE_URL | Medium |
| 10 | No FK dispatch→drone | droneIds JSONB-only, O(n) cleanup | Medium |
| 11 | High auto-discard rate (67%) | 3,131/4,646 discarded | Medium (needs discard_reason) |
| 12 | Heuristic never used standalone | 1631 combined vs 1 heuristic | Low (evaluation mode) |
