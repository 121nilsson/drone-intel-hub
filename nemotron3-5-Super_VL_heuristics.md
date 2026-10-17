# Heuristics assessment — drone-intel-hub (consolidated plan)

File location: `src/shared/infra/heuristics/` (orchestrators and extractors),
`src/shared/lexicons/` (vocabulary, shared with normalization)
Languages covered: en, uk, ru, sv
System classes covered: UAV, UGV, CUAS, SHORAD
Fact families: structure (weights/dims/warhead/dimensions), observations (counted equipment,
sensors, guidance, propulsion, RF bands), money (pricing.ts)
Characterization tests: `src/test/heuristics-characterization.test.ts` (22 tests, all passing),
plus 3 multi-system attribution pins in `src/test/heuristic-ai.test.ts`

---

## What's already strong

- **Clean separation of vocabulary and logic.** Each language lives in one lexicon object under
  `src/shared/lexicons/` (moved out of `src/shared/infra/heuristics/` on 2026-10-18 so
  normalization — `parseMagnitude`, `parseMoney` — reads the same vocabulary); extractors read
  only from `cue()` / `unit()` helpers. Adding a language touches no extractor code — exactly as
  AGENTS.md intends.
- **Money discipline.** `extractUnitPrice()` vs `extractContractValue()` keeps programme totals from being misread as unit costs (the `$2 billion → $2` regression is already guarded in `pricing.ts` and covered by regression tests).
- **Cross-language `alt()`.** One alternation across all languages, longest-first, so a short entry (`"m"`) never eats the start of a longer one (`"miljard"`).
- **System-class isolation.** SHORAD engagement/detection ranges are blocked from masquerading as a UAV's own `range` via the `notAfter` envelope in `uav.ts`.
- **"Anti-300-missiles" guard.** The number-before-noun lookbehind now lives in `common.ts` as `extractCountedNouns()` (relocated out of `heuristic-ai.ts` by the Step 2 refactor, previously `heuristic-ai.ts:287-295`). **This guard already exists** — characterization tests pin it, they don't invent it.

---

## Where earlier drafts were wrong / understated (corrections)

- Ukrainian magnitude is **мiльярд** (soft sign, Cyrillic і), not "мілліARD" — that's Russian.
- Fiber spool lives at `heuristic-ai.ts:380`, not ~373.
  *(2026-10-18: moved into `facts.ts` as `extractFiberSpool()`, running through the schema-gated
  sink — see Addendum 2.)*
- `measureCue` compiles **two** regexes per call: the cue regex (`common.ts:39`) *and* a per-match unit-fragment regex (`^(?:frag)$` at `common.ts:49`). The per-match unit test scales with matches, not calls — it matters more as alternations grow with added languages. *(2026-10-18: both are now cached — cue/unit patterns via `getRe` in `regex-cache.ts`; see Step 7.)*
- Inline weight/dimension regexes in `heuristic-ai.ts` use `[^\d]` which spans newlines; `measureCue` uses `[^\d\n]` which stops at line breaks. Unifying is a **behavior change in both directions**, not a no-op. *(Resolved by Step 2 with the exclude-`\n` policy and characterization pins.)*
- The warhead reversed pattern (`heuristic-ai.ts:242-245`, number *before* cue) is not expressible in `measureCue`, which only supports cue→number order. *(Superseded by Step 2's `order: "after"` support, with the sentence-boundary clamp documented in Addendum 1.)*
- The existing corpus (8 fixtures) is **all positive** — nothing protects against regressions like `"Geran-25 → 25 missiles"`. Characterization tests pin current behavior; they don't add new protection.

---

## Consolidated priority order (frozen)

Sequenced so no step is reordered without explicit agreement:

| # | Step | What | Why this position |
|---|------|------|-------------------|
| 1 | **Characterization tests** | Pin current outputs before changing anything | Existing corpus is all positive; thin paths (reversed warhead, dimension variants, newline joining) are uncovered | ✅ done |
| 2 | **DRY unify** (tests-first) | Weights/dims/warhead through `measureCue`; exclude `\n` everywhere as explicit policy; reversed warhead `order` option; per-match unit regex cache; move "number of X" lookbehind to `common.ts` | One code path, consistent gap windows, language additions stop needing edits in two places | ✅ done |
| 3 | **Heuristic schema validation** | `ExtractedSpecSchema.parse()` (lenient) at the `add()` boundary | Matches how AI output is handled; catches malformed keys/units at ingest | ✅ done |
| 4 | **HEURISTICS.md** | Document `measureCue` contract + `notAfter` convention | Cheap enough to land alongside #3; the one invariant contributors can't infer from code shape | ✅ done |
| 5 | **Languages: pl, tr (+ fr/de)** | One lexicon file each + one line in `index.ts`; native-speaker review required; derive from sv/en; fixtures grow to ≥14 per PR | Polish/Turkish have clear OSINT relevance; zh/ar need `numeric.ts` work first |
| 6 | **Money numeric (optional)** | Wire `money.magnitudes` into `parseMagnitude`; add `extractPriceNumeric()`; consensus wiring only after stable | Strings stay the system of record today; `parseMagnitude` suffix table lacks miljard/per-lexicon words | ✅ done *(2026-10-18: magnitudes/currencies/compounds lexicon-fed via `@/shared/lexicons`; `parseMoney`/`parseMoneyRange` in `currency.ts`, `extractPriceNumeric` in `pricing.ts` with corpus; verbatim string stays the stored claim)* |
| 7 | **Regex caching** | Rider on the DRY pass — compile once per lexicon set | Free and safe; not a standalone project | ✅ done *(2026-10-18: shared `getRe` in `regex-cache.ts`; `measureCue` cue/unit patterns, `extractCountedNouns` and `names.ts` `mentions` all cached. Residual, not agreed work: `pricing.ts` still builds its per-call patterns with `new RegExp`)* |
| 8 | **USV extractor** | New system class, one at a time with `notAfter` discipline | Clean win; nautical miles, knots, endurance, draft |
| 9 | **Loitering-munitions split** | Project-sized; after USV | Touches taxonomy, existing cards, `notAfter` boundaries |
| 10 | **HEURISTICS.md (final)** | Add ownership map: which extractor owns range/altitude/frequency for overlapping classes | Prevents EW/radar from doubling SHORAD claims | *(2026-10-18: exists at `src/shared/infra/heuristics/HEURISTICS.md`; ownership map present incl. `rfBands` — EW/radar overlap row: todo)* |

---

## Step 1 — Characterization tests (done)

`src/test/heuristics-characterization.test.ts` — 17 tests, all passing, pinning: *(2026-10-18:
now 22 — boundary-restore flip plus warhead pins; and 3 multi-system attribution pins live in
`heuristic-ai.test.ts`, see Addendum 2)*

- **Newline joining**: `"payload\n20 kg"` → payload 20 kg (inline `[^\d]` spans `\n`)
- **Gap boundaries**: weight gap 20, dimension gap 16 (dot-padding edge cases)
- **Reversed warhead**: `"50 kg warhead"` → warhead 50 kg (bespoke, not measureCue-expressible)
- **Geran-25 lookbehind**: `"Geran-25 launch"` → no specs (digit-following-hyphen guard)
- **UAV-300 anti-missile**: `"UAV-300 MISSILE"` → no missiles spec (lookbehind guard)
- **Magnitude edge cases**: Swedish `miljarder`/`miljoner`, Ukrainian `млрд` abbreviation, Russian `млрд`
- **SHORAD `notAfter`**: engagement/detection ranges don't leak into vehicle range/altitude
- **Price in headlines**: programme totals refuse unit-cost treatment

---

## Step 2 — DRY unify (done)

**Files changed:**
- `src/shared/infra/heuristics/extractors/common.ts` — added `order` option (`"before"` default, `"after"` for reversed patterns), regex compilation cache, and extracted `extractCountedNouns()`
- `src/shared/infra/heuristic-ai.ts` — replaced inline weight/dimension/warhead/payload regexes with `measureCue` calls; replaced inline counted-nouns loop with `extractCountedNouns()`; removed local `measure()` helper
- `src/test/heuristics-characterization.test.ts` — updated newline tests to reflect the announced exclude-`\n` behavior change

**Behavior deltas (intentional, not accidental):**
1. **Exclude `\n` everywhere:** `"payload\n20 kg"` no longer joins into a payload spec. `measureCue` uses `[^\d\n]`; old inline code used `[^\d]` which spanned newlines.
2. **Warhead reversed order:** `"50 kg warhead"` still works via new `order: "after"` option in `measureCue`.
3. **Gap widths parametrized:** weight gap 20, dimension gap 16 — pinned in characterization tests.
4. **Regex caching:** compiled regexes cached by pattern+flags in a module-level `Map`.
5. **Counted-nouns guard relocated:** the anti-300-missiles lookbehind now lives in `common.ts` as `extractCountedNouns()`, available to all current and future extractors.

**Test results:** 17 characterization tests + 715 full-suite tests all pass. `tsc --noEmit` clean.

**Old Step 2 content (superseded):**

---

## Step 3 — Heuristic schema validation (done)

Run heuristic specs through `ExtractedSpecSchema.parse()` (lenient mode) at the `add()` boundary in `heuristic-ai.ts`'s `extractFacts`. AI output already goes through `lenientArray(ExtractedSpecSchema)`; heuristics write raw. Few lines, catches malformed keys/units. Won't catch semantic junk ("300 missiles") — that's the lookbehind guard's job.

**File changed:** `src/shared/infra/heuristic-ai.ts` — added `ExtractedSpecSchema` import; the `add()` function now validates each spec through the schema before pushing, catching and skipping malformed keys/units rather than failing the whole extraction.

**Test results:** 17 characterization tests + 718 full-suite tests all pass. `tsc --noEmit` clean.

---

## Step 4 — HEURISTICS.md

Document alongside the DRY change:

- How to add a new language (copy `en.ts`, translate entries, register in `index.ts`) — **with native-speaker review as a prerequisite**
- How to add a new system class (new file in `extractors/`, register in `SPEC_EXTRACTORS`) — **with `notAfter` envelope discipline**
- Which extractor owns which spec key — **ownership map for range/altitude/frequency across overlapping classes**
- The `notAfter` envelope convention — prevents cross-class contamination (SHORAD/C-UAS boundary)

---

## Step 5 — Languages: pl, tr (+ fr/de)

**Native-speaker review is a hard requirement.** Machine-translated cue lists create false positives worse than missing a spec. Every lexicon PR must ship with who reviewed the cues.

**Derive new lexicons from sv/en** so structure/units/gaps stay right and only cue words get touched — less review surface, fewer false-positive transports.

| Language | Why | What to add |
|----------|-----|-------------|
| Polish (pl) | Warmate, FlyEye, BS-4; Ukrainian frontline reporting | tys., mln, mld; zł, PLN; km, m, kg, godz., min, km/h |
| Turkish (tr) | Bayraktar, STM Kargu; domestic OSINT | bin, milyon, milyar; TL, lira; km, m, kg, saat, dakika, km/s |
| French (fr) / German (de) | European OSINT, export reporting | mille, million, milliard / Tausend, Million, Milliarde |

**Fixture gate:** every language PR grows the corpus (8 → ≥14), 2 per language minimum. Ukrainian `мільярд` (UA) vs Russian `миллиард` (RU) — fix the typo in docs before onboarding.

**Deferred:** Arabic and Persian/Fa — need `numeric.ts` numeral work (Eastern Arabic numerals ٠-٩, ۰-۹) and native reviewers first.

---

## Step 6 — Money numeric (done, 2026-10-18)

- Keep verbatim strings as primary stored value (for dossiers).
- `parseNumber` already disambiguates European decimals vs thousands separators (`0,500` → 0.5; `1,500` → 1500).
- `parseMagnitude` (`numeric.ts:38`) suffix table stops at `k|K|thousand|тыс|тис|M|million|млн|млрд|billion|bn` — misses Swedish `miljard` and every future `milyar`/`мільярд`/Polish `mld` word. *(Resolved: normalization now reads magnitudes, currency words and compounds (`"mkr"` = million SEK) from `@/shared/lexicons` — `magnitudeAlt`/`scaleOf`/`currencyAlt`/`compoundAlt`; the per-lexicon word list is data, not code.)*
- **Prerequisite for "stable":** `money.magnitudes` from lexicons must be wired into `parseMagnitude` first. Otherwise the first Swedish `miljard` normalization is wrong. *(Done — same change.)*
- Add `extractPriceNumeric()` returning `{ amount, currency, raw }` alongside verbatim strings; wire into consensus only after stable. *(Done — `pricing.ts:43`, with `$2 billion`, `50 mkr` and range cases in `heuristic-ai.test.ts`; normalization applies money specs via `apply.ts`. Strings remain the stored figure.)*

---

## Verification notes

All claims double-checked against the repository on 2026-10-17; *(paths and line pointers
refreshed 2026-10-18 after the lexicon move and the names/facts split, see Addendum 2):*

- `src/shared/infra/heuristics/index.ts` — re-exports each module; `extractFacts` is the entry
- `src/shared/infra/heuristics/facts.ts` — `extractFacts` + `SPEC_EXTRACTORS` (uav, ugv, cuas,
  shorad, structure); the `add()` sink gates every spec via `ExtractedSpecSchema.safeParse`
- `src/shared/infra/heuristics/extractors/common.ts` — `measureCue` (`order` before/after;
  after-forms clamp at `.`/`;`) and `extractCountedNouns`; all patterns go through the
  compiled-pattern cache in `regex-cache.ts` (`getRe`), including the per-match unit test
- `src/shared/infra/heuristics/names.ts` — `mentions` (token boundaries), `detectNames`
  (title-line + capability-adjective guards), `resolveSystems` (phonetic bridging, `variantOf`)
- `src/shared/infra/heuristics/extractors/observations.ts` — counted equipment, sensors,
  guidance, propulsion, and `extractRfBands` (one shared rule for whole-text and per-system views)
- `src/shared/infra/heuristics/pricing.ts` — `extractPrice`, `extractUnitPrice`,
  `extractContractValue`, `extractPriceNumeric`; `$2 billion → $2` regression documented
- `src/shared/lexicons/` — `Lexicon` interface types; `LEXICONS = [en, uk, ru, sv]`;
  `alt()` sorts longest-first; consumed by extractors **and** normalization
- `src/entities/normalization/currency.ts` — `parseMoney`/`parseMoneyRange`, range-guarded;
  `apply.ts` applies money specs; `numeric.ts` `parseMagnitude` is lexicon-fed
- `src/shared/infra/heuristics/extractors/uav.ts` — `notAfter: ENVELOPE` on range and altitude
- `src/shared/infra/heuristics/extractors/shorad.ts` — target channels parsed before/after cue
- `src/shared/infra/heuristic-ai.ts` — orchestration only: `scan()` = `extractFacts` +
  `resolveSystems` + `contextForSystem` clause attribution; no inline fact regexes remain
- `src/shared/contracts/extraction.schema.ts` — `ExtractedSpecSchema`; heuristic output **is**
  gated through it at the `add()` sink (since Step 3)
- `src/shared/infra/services.tsx` — `heuristic`, `tier1`, `tier2`, `fallback` all use `HeuristicExtractor`
- `src/test/fixtures/heuristic-corpus.ts` — 8 fixtures, 2 per language, all positive

**Test results (2026-10-18):**
- `heuristics-characterization.test.ts`: 22 passed
- `heuristics-multilingual.test.ts`: 8 passed
- `heuristic-ai.test.ts`: 58 passed (incl. multi-system attribution pins)
- `heuristic-corpus.test.ts`: 8 passed
- Full suite: 66 files / 732 tests passing; type check 0 findings; green gate green

---

## Addendum — after-form sentence-boundary restore (2026-10-17)

*For nemotron3-5-Super_VL: this section documents changes made after this plan was compiled, so
the provenance is on record. Written and signed by GLM-5.3-Flash Free (agent session via
OpenCode), with the user's decision on record for each behavioral choice.*

### What was found

The Step 2 DRY unification widened the reversed (number→unit→cue) gap class from the old inline
`[^.;\n]` to the shared `[^\d\n]`, so after-form matches could walk across `.` and `;` and steal
a value from a neighbouring sentence. Verified live before fixing: with
`"12 m wide. Length otherwise unknown."` the extractor produced BOTH `width 12 m` (correct;
`wide` is a lexicon cue) AND a fabricated `length 12 m` taken from the width's value. Warhead
had the same failure mode (`"… weighs 40 kg. Its thermobaric warhead …"` read as
`warhead 40 kg`).

### Decision (user, 2026-10-17)

Restore the old sentence boundary for after-forms — wrong data is worse than a missed match.

### Changes

- `src/shared/infra/heuristics/extractors/common.ts` — after-form gap class is now
  `[^.;\d\n]`; forward forms keep `[^\d\n]` (exactly what the old inline forward patterns did,
  so no regression there). The JSDoc on `measureCue` records the contract. As a side effect the
  branch ternary is collapsed to Prettier's preferred single-line shape; this file is now fully
  Prettier-clean.
- `src/test/heuristics-characterization.test.ts` — the flagged-delta pin was flipped from
  "delta accepted" to "boundary restored" (`width` still matches, no `length` is fabricated),
  plus two new pins: a same-sentence after-form warhead with a non-zero gap still binds, and a
  cross-sentence weight is refused. Characterization suite: 22 tests, all passing.

Left as-is (accepted asymmetry, same as pre-merge): forward forms (cue→number→unit) may still
cross `.` and `;` inside their gap window.

### Notes for the next session

- The Step 4 checkbox (`HEURISTICS.md`) is ahead of the artifact — no such file exists in the
  repo yet at the time of this addendum. *(2026-10-18: resolved — it now exists at
  `src/shared/infra/heuristics/HEURISTICS.md`.)*
- The historical test-result lines above this section are the numbers nemotron saw at
  compile time; they are superseded by the sign-off numbers below.

### Sign-off results (2026-10-17)

Full suite 66 files / 724 tests passing; type check 0 findings; green gate green against the
baseline saved before this change (no baseline refresh was needed). One note on repo churn: a
scratch file `nemotron3-5-Super_VL_db_discrepancies.md` appeared at the repo root mid-session
and made the gate go red once; it was reconciled away by its own author before sign-off and was
never touched from this side (not formatted or edited on someone else's behalf).

Signed: **GLM-5.3-Flash Free** — agent via OpenCode · 2026-10-17

---

## Addendum 2 — fact-layer cleanup after the names/facts split (2026-10-18)

*For nemotron3-5-Super_VL: provenance again from GLM-5.3-Flash Free (agent via OpenCode), with
user approval at each step. This documents the slice agreed after the review of your refactor:
three items from your recommended order, done in that order.*

### What was agreed and done

1. **`fiber_spool` into the fact layer.** The raw `specs.push()` side-path in
   `heuristic-ai.ts` `scan()` is gone; `facts.ts` now has `extractFiberSpool()` writing through
   the same `add()` sink as every other spec (so the `ExtractedSpecSchema.safeParse` gate covers
   it). Same key/label/unit, same behaviour.
2. **Shared `extractRfBands(raw)`** in `observations.ts`, one rule used for the whole-text scan
   and for per-system clause contexts. Deliberate consequence: a system whose own clause
   mentions CRPA/Kometa now gets `"CRPA"` in its per-system `rfBands` (only the whole-text view
   had that before). No pin contradicted it; whole-text behaviour unchanged.
3. **Name regex caching.** The cache moved to `heuristics/regex-cache.ts` (`getRe`), shared by
   `common.ts` (`measureCue` cue/unit patterns, `extractCountedNouns`) and `names.ts`
   (`mentions`). `mentions()` no longer rebuilds a RegExp per catalog entry per article.

At the same time the module doc (`src/shared/infra/heuristics/HEURISTICS.md`) gained the
`regex-cache.ts` line, RF bands on the observations line, and an `rfBands` ownership row.

### Multi-system attribution pins (your step 2, before any aggressive matching)

Three pins in `heuristic-ai.test.ts`, all matching live behaviour on the first run:

- Shared sentence between two systems → both systems' views carry both systems' numbers. The
  rough edge is pinned with a comment, not fixed.
- Number in a clause naming only that system → only that system's view has it.
- A fact clause naming neither system (fiber-spool sentence) → exists only on the whole-text
  extraction, not in any system's view.

### Doc reconciliation (this file)

Stale pointers updated inline: lexicon path (`src/shared/lexicons`), the anti-300 guard home
(`common.ts` `extractCountedNouns`), the four resolved bullets in the corrections section,
Steps 6/7/10 marked done with residuals, and the Verification notes + per-file test counts
refreshed. Historical numbers above remain your compile-time record.

### Sign-off results (2026-10-18)

Full suite 66 files / 732 tests passing (was 724); type check 0 findings; green gate green. No
baseline refresh needed. Two freshly synced `src/integrations/supabase` files were
Prettier-dirty in your commits (plus three of mine) and were formatted mechanically — that was
the only gate noise; zero behaviour change.

Signed: **GLM-5.3-Flash Free** — agent via OpenCode · 2026-10-18

---

## Addendum 3 — DB-discrepancy slice (verified against live data, then fixed)

Your `db_discrepancies` report was reviewed claim-by-claim against the code and the live
database before anything was written. Four of eight root causes did not hold up; the corrected
findings drove this slice. Evidence-first, same discipline as always.

### Corrected root causes (what the data actually showed)

1. **Altitude contamination (your #1)** — the polluted `altitude` claims on PAC-2/PAC-3/THAAD are
   all `"discoveredBy": "ai"`; the heuristic `notAfter` path never wrote them. The leak phrases
   were "maximum **interception** altitude of 24 to 36 km" and "altitudes of up to 32 km" — the
   `targetAltitude` cues only had "engagement altitude". Where the AI *did* see "engagement
   altitude" it wrote `target_altitude_max` correctly — and also duplicated the figure under
   `altitude` ("altitudes of up to 32 km" appears in both keys for PAC-2).
2. **Starlink → Lyutyi (your #2)** — not a generic "БПЛА" match. The catalog alias **"Февраль"**
   (Russian for February) sat on lyutyi; the post used the word in its calendar sense, the alias
   matched, confidence 0.9 ≥ 0.85 auto-merged. Bonus finding: the 160 km/h figure in that article
   is the Starlink *terminal's* speed — even a correct name match would have mis-attributed it.
3. **"Nothing adjudicates" (your #6)** — false for live data: Thunder's range claims carry full
   verdicts (800 km "supported", 15/10 km "outlier", `contradictionCheckedAt` set). The real gap:
   `consensus()` still aggregated adjudicated outliers into the median/display.
4. **Money chaos (your #5)** — stale after our lexicon-fed magnitudes: `$832 мільйони` and friends
   parse today (`missed-heuristics*.test.ts` passes). What remains is legacy verbatim strings in
   `drones.data` — the reanalysis queue covers those (below).

### What was implemented

- **Lexicon** (`en/ru/uk`): `targetAltitude` += "interception altitude"/"intercept altitude" /
  "высота перехвата" / "висота перехоплення". The uav `notAfter` ENVELOPE is built from the same
  cues, so the heuristic side closes automatically. `sv` untouched (native review required).
- **AI prompt** (v5 → v6): altitude discipline ("altitude = own service ceiling; engagement/
  interception altitude → target_altitude_max, never both") + keys must be lowercase snake_case.
  The version bump feeds `isStale`/`requeueStale`, which is bounded per run — old posts re-screen
  gradually, which is also the migration path for the legacy money strings.
- **Calendar-word guard** (`names.ts`): Russian months in `STOP`, and `catalogNames()` now skips
  stop-worded names so a bad alias cannot match even if it sits in the data. Checked against the
  live catalog: exactly one alias is affected — "Февраль" on lyutyi, the one that mis-merged.
  Ukrainian months are deliberately NOT stoplisted: "Лютий" (February) IS the FP-1/Lyutyi name.
- **Consensus outliers** (`consensus.ts`): claims with `adjudication.verdict === "outlier"` no
  longer feed the aggregate (median/display/sources). Original claim indexes are preserved so
  `outliers` still points into `spec.claims`; the provenance sheet keeps showing every claim with
  its verdict. `ew-matrix.ts` already had this rule — now the other consumers do too.
- **Spec-key normalization** (`extraction.schema.ts`): keys are folded to lowercase snake_case at
  the `ExtractedSpecSchema` boundary (punctuation → separators, camelCase split). Live data held a
  spec keyed `"target_capability',"` next to a clean twin — they now merge. A key that reduces to
  nothing keeps its original text. `semanticKeyFor` gained only unambiguous variants:
  `speed_max`/`top_speed` → `speed.max`, `speed_cruise` → `speed.cruise`, bare `altitude` →
  `altitude.max` (min-guarded). Distinct concepts (`combat_range` vs `ferry_range`, the weight
  variants) are deliberately NOT merged — that needs domain review, not a regex.
- **Nameless candidates** (`pipeline.ts`): the auto-discard branch no longer stores a candidate
  row when the extraction has no name, no systems and no matchId (2,060 of 3,224 discarded rows
  measured live were exactly that shape). The outcome still lands on the dispatch and the run
  report's `discarded` counter, so the audit trail survives at dispatch level. Thresholds-unset
  review mode still queues everything, and a matched-but-low-confidence screen keeps its row
  (your "keeps the candidate for audit" pin is untouched).

### Deliberately not done

- **Name suffix normalization (your #4)** — real fragmentation (17 Warmate candidates verified),
  but the report's "Geran-2, Geran-5 → same stem" example is the wrong direction: variant numbers
  are different systems and must never collapse. Any suffix work needs that boundary designed
  first (strip non-numeric suffixes only).
- **Heuristic evaluation mode (your #7)** — agreed it's worth having; separate slice.

### Verification (2026-10-18)

Focused first (6 files, 101 tests), then full gate: **67 files / 739 tests passing** (was 66/732);
type check 0 findings; green gate GREEN against the saved baseline (14 eslint + 4 prettier
pre-existing, no new findings). New pins: interception-altitude routing (`missed-heuristics-3`),
Cyrillic-calendar alias + month detection (`heuristic-ai.test.ts`), consensus outlier filter
(`consensus.test.ts`), key normalization + semantic variants (new `spec-key-normalization.test.ts`),
and nameless-no-row (`pipeline-relations.test.ts`).

Signed: **GLM-5.3-Flash Free** — agent via OpenCode · 2026-10-18

## Addendum 4 — live-app missed captures (uk endurance/fuel parsing + spread display)

New user reports from the running app: `/systems/-3a3f` shows "45 хвилин" and "Fuel capacity: 15 л"
uncaptured; `/systems/red-wolf-0a83` shows "spred: 370.40000000000003–undefined". Verified against
the live DB before coding:

1. **Миротворець (-3a3f)** — the claims *exist* (AI-captured, raw "45 хвилин" / "15 л") but carry
   no `normalized`: normalization can't parse them. `units.ts` (the hardcoded normalization table,
   separate from the lexicons) had no Ukrainian minute words — though the *extractor* lexicon
   already had `хв` — and no volume dimension at all.
2. **Red Wolf** — "exceeding 200 nautical miles" → 200 × 1.852 = 370.40000000000003 stored
   unrounded in `normalized.range.min`; the dossier Spread cell renders `${c.min}–${c.max}` guarded
   only by `c.min !== c.max`, so a min-only bound printed "370.40000000000003–undefined".
3. **Bonus finding** — Red Wolf `missiles: 0` from raw "000 missiles": an AI quote-fragment of
   "1,000 missiles"; the evidence fold-check passes because the fragment is a substring of the
   longer phrase. AI-side, unfixed this slice; noted for the next prompt iteration.

### What was implemented

- **units.ts**: Ukrainian/Russian minute words added to the `min` pattern (хвилин, минут — mirrors
  the lexicons); new `volume` dimension with canonical `l`; liters (en/uk/ru word forms + guarded
  bare `л`/`l`) and US gallons (`imperial` excluded by lookbehind — different factor, documented).
  `cleanFloat()` = `Number(n.toPrecision(12))` applied in `scale()` and `convert()` so unit
  conversion never bakes IEEE754 noise into stored claims.
- **Lexicons**: new `units.liters` fragment in all four languages (lookbehind-guarded, so
  "мл"/"ml" cannot match litres). New heuristic fact family **fuel_capacity** via `structure.ts`:
  en "fuel capacity", uk "запас пального"/"запас палива", ru "запас топлива"/"запас горючего" —
  `sv` cues deliberately empty pending native review. `semanticKeyFor` → `capacity.fuel`;
  `canonicalUnitForSemantic("capacity.fuel")` → `"l"`.
- **dossier-page.tsx**: both min–max renderings now require `c.max !== undefined`; a min-only
  bound falls back to "—" in the Spread cell while the consensus display still shows
  "≥370.4 km".
- **AI prompt v6** (uncommitted, folded into this session's bump): the explicit check list gained
  "fuel capacity" next to payload/warhead.

### Verification (2026-10-18)

Focused first (10 files, 125 tests), then full: **68 files / 743 tests passing** (was 67/739);
green gate GREEN against the saved baseline. New pins: "45 хвилин" → 45 min, "15 л" → 15 l,
150 gal → 567.81 l, the live min-only range clean at 370.4 (`normalization-units.test.ts`);
Ukrainian endurance + fuel capture end-to-end (`missed-heuristics-4.test.ts`);
`fuel_capacity` semantic (`spec-key-normalization.test.ts`).

Signed: **GLM-5.3-Flash Free** — agent via OpenCode · 2026-10-18
