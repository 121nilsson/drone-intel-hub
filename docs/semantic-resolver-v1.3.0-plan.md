# Semantic resolver v1.3.0: implementation plan

> **Status:** direction approved; the open decisions were taken on 2026-11-26 (see the last section). G-0 is closed (2026-11-26): `npm run green` runs reliably from an upper-case `C:` working directory. No code may change until the approval criteria of the delivery in question are signed off. Source: [semantic-resolver-v1.2.0-false-withholding-rca.md](./semantic-resolver-v1.2.0-false-withholding-rca.md).
>
> **Direction:** v1.3.0 is built around (1) correct language detection and (2) controlled alias growth. Ambiguous concepts stay unresolved until a written semantic decision exists. A higher Resolution or Withholding Precision on known cases is not a goal in itself.

## 0. Principles

1. **Two questions, kept apart.** "Can we identify the term?" and "Can we identify which attribute the term describes?" are different questions. A recognised but under-specified term is a **Class 4 ambiguity** (`unresolved_ambiguous`), never a resolution. Examples: `потолок` ("ceiling") and `двигун` ("engine").
2. **Declared language ≠ detected language.** Language from source metadata or the frame row and language computed by `detectLanguage` are stored, compared and reported separately. They are never merged into one field.
3. **v1.2.0 stays frozen.** Nothing under `src/test/fixtures/semantic-eval/` or `semantic-eval-v1.2.0/` is regenerated or edited, including decisions.
4. **The nine RCA cases are diagnostic, not proof.** The rules are designed after seeing them, so improvement on them is circular by construction. Generalisation is shown only on material the rules were not designed against.
5. **One delivery = one reviewable change**, each with its own tests, its own resolver hash where relevant, and its own approval.

## Prerequisite G-0: a working test runner — closed 2026-11-26

**Observation.** Every vitest file failed before collection with `TypeError: Cannot read properties of undefined (reading 'config')`. This happens **only when vitest starts from a working directory with a lower-case drive letter** (`c:\dev\drone-intel-hub`). From `C:\dev\drone-intel-hub` the same command passes. This was reproduced by running vitest from both spellings in one run.

**Mechanism: not confirmed.** One hypothesis is that the module is loaded twice, once per path spelling. It was not verified in the vitest source and is recorded here as a hypothesis only.

**Result (run from `C:\`, vitest 4.1.12, node 24.22.1):**

- `npm test`: 200 test files and 2332 tests passed (plus skipped and todo); no failures.
- `npm run green`: no new findings against the baseline.
- The 67 tests in these files passed when run separately: `docs-paths`, `language-detect`, `semantic-resolver-alias-coverage`, `semantic-replay`, `semantic-eval-verify`.
- No code, configuration or dependency change was needed.

**Known environment constraint:** run tests from a path with an upper-case `C:`. This is documented in `AGENTS.md` under "Working here".

**Deferred:** a guard in `vitest.config.ts` that makes both spellings work. If wanted, it is a separate, isolated change, tested from both spellings.

---

## D0 (P0): language detection, fixed and measured on its own

### Why first

- `detectLanguage` ([language.ts:38](../src/entities/normalization/language.ts#L38)) requires at least 2 Ukrainian-only letters. Short Ukrainian text therefore becomes `ru`. Reproduced on the frame excerpts of demo-018, demo-019 and demo-020.
- **It already affects production today, not only the resolver:**
  - `riva.pairFor` ([ai-proxy.server.ts:455](../src/shared/infra/ai-proxy.server.ts#L455)) sends Ukrainian text to the translator as `ru-en`;
  - the translation shortcut ([ai-proxy.functions.ts:56](../src/shared/infra/ai-proxy.functions.ts#L56)) and the dossier summary ([dossier-summary.tsx:95](../src/features/dossier/dossier-summary.tsx#L95)) also depend on it.
- **In evaluation:** `FrameRow.language` is documented as "derived by the sampler when absent" ([types.ts:225](../src/entities/normalization/semantic-eval/types.ts#L225)). A declared language and a detected language end up in the same `Example.language` field, so their provenance is lost. The synthetic frame declares language, which hides the defect. The historical frame will not declare it (dispatches store no language).

### Design (to approve before code)

1. **Keep the public contract, add an evidence API.**
   - `detectLanguage(text): DetectedLanguage` keeps its signature for current callers.
   - A new pure function `detectLanguageWithEvidence(text)` returns a `LanguageDetection`:
     - `language`;
     - `decisive: boolean`;
     - `reason`: a closed set of codes, including `cyrillic_undetermined` for Cyrillic text without decisive letters;
     - `evidence`: Cyrillic/Latin counts, Ukrainian-only letters `іїєґ`, Russian-only letters `ыэъё`.
   - `detectLanguage` becomes a thin wrapper, so the rule is defined once.
   - **Uncertainty travels with the value.** Any module that hands a detected language to another module passes the whole `LanguageDetection`, never the bare string. A later component therefore cannot treat a guess as a fact.
   - **Uncertain Cyrillic is logged.** The detector stays pure. The calling server code (`ai-proxy.server.ts`, the sampler report) records `cyrillic_undetermined` cases, so they are available for later improvement. The record holds only the reason and counts, not the text.
2. **Rule (implemented; revised in review, 2026-11-26).** The RCA candidate counted every Ukrainian-only or Russian-only letter. In review it made Russian text that mentions a Ukrainian name decisive `uk`, for example "Агентство Укрінформ сообщает…" and "Київ подвергся атаке дронов…". The maintainer decided:
   - **Proper names and place names never decide the language on their own.** A distinctive letter counts only in an **ordinary word**. That excludes:
     - capitalised words;
     - all-caps words;
     - the first word of the text or of a sentence (after `.`, `!`, `?`, `:` or a line break);
     - text inside «…», „…“ or "…".
   - **Decisive needs sufficient aggregate evidence.** At least one Ukrainian-only (іїєґ) or Russian-only (ыэъё) letter must appear in an ordinary word, with none from the other language in ordinary words. Insufficient or conflicting evidence gives a non-decisive result.
   - **Non-decisive Cyrillic keeps the pre-D0 language** from the old full-text rule (≥ 2 Ukrainian-only letters → `uk`, else `ru`). Translation routing for it is therefore unchanged.
   - **Accepted consequence:** short sentences whose only distinctive letter is in the first word ("Дальність польоту становить 250 км.") are non-decisive. They route `ru-en` as before and pass no language to the resolver.
   - **Known residual risks:**
     - a lower-case proper name inside a sentence;
     - Surzhyk or an unquoted Ukrainian word inside Russian text;
     - Belarusian and Bulgarian (and other Cyrillic languages), which are not supported. Reproduced in the development set: see "D0 status".

3. **D0-Q1, decided: option (a).** Cyrillic text without a decisive letter:
   - translation callers keep today's behaviour (`ru`), for backward compatibility;
   - the resolver and the evaluation treat it as language unknown (only `all` rules apply);
   - it is never counted as a confident detection in any metric.
4. **Provenance in evaluation (schema 1.1.0, decided).** Only new directories use it.
   - `FrameRow.declaredLanguage?` holds language stated by a trustworthy source or its metadata. It replaces the overloaded `language`.
   - `Example` gains:
     - `declaredLanguage?`;
     - `detectedLanguage`;
     - `languageDetectionDecisive`;
     - `languageDetectionReason`.
   - **`declaredLanguage` is never written by automatic detection** and never overwritten by it.
   - `Example.language` (the stratum language) follows one documented rule: declared if present; else detected if decisive; else `unknown`. The rule is recorded in the manifest.
   - **Backward compatibility is absolute.** Readers accept schema 1.0.0 unchanged, v1.2.0 directories verify bit-identically, and old data is never reinterpreted.
   - **As implemented:**
     - **1.1.0 is opt-in.** Use `--schema-version 1.1.0` on the sampler script; 1.0.0 stays the default.
     - **Under 1.1.0 the legacy `FrameRow.language` is refused** (review finding R1, 2026-11-27). The field cannot say whether it holds a declaration or a detection, so it is never used as a fallback for `declaredLanguage`. The freeze fails with an error that names `declaredLanguage`. A fixture frame frozen under 1.1.0 must move its hand-set language to `declaredLanguage`. The D5 historical export sets `declaredLanguage` only from trustworthy source metadata, and otherwise leaves it empty. Schema 1.0.0 keeps its behaviour: there, `language` is required. (Before R1, 1.1.0 read `language` as a declaration, and only this document stopped an export from filling it from detection.)
5. **Resolver caller rule:** a caller passes a language to `resolve()` only when it is declared, or detected _and_ decisive. As implemented, the rule lives in and is documented on `languageForResolver` in `src/entities/normalization/semantic-eval/sampling.ts`, the only place that passes a frame language to `resolve()`. `semantic-resolver.ts` was not changed.

### End-to-end language provenance

A better `detectLanguage` is not enough if the wrong language still reaches the translator, or if provenance is lost in the data model. The origin and certainty of the language must be traceable through the whole chain:

```
source metadata / original text
  → language detection + decisiveness   (detectLanguageWithEvidence)
  → translation routing                  (riva.pairFor)
  → FrameRow language provenance         (declaredLanguage / detectedLanguage)
  → semantic resolver                    (language passed only if declared or decisive)
```

Each step is checked separately, plus at least one **end-to-end test**. It takes a short Ukrainian sentence without declared language through every step. Under revision 3 (variant B) the decisive sentence is "Дрон вже має дальність польоту 250 км.": вже counts in channel W, має and дальність in channel L. The earlier "Дрон має дальність польоту 250 км." is non-decisive under B, because it has evidence from channel L only. The test verifies that:

- detection gives `uk`, decisive;
- `pairFor` gives `uk-en`;
- the frozen example keeps `declaredLanguage` empty and `detectedLanguage = uk`;
- the resolver receives `uk`.

Two further runs use undecidable Ukrainian sentences: "Корисне навантаження становить 35 кг." and "Дальність польоту становить 250 км." (whose distinctive letter is only in the first word). They verify that translation keeps `ru-en` (decision (a)), the reason `cyrillic_undetermined` is recorded, and the resolver receives **no** language.

### Language test corpus (new fixture, `origin: "fixture"`)

Hand-written, labelled sentences in a separate file, for example `src/test/fixtures/language-detect-corpus.ts`. Every row has an expected language **and** an expected `decisive`. Minimum coverage, with at least 5 rows per category:

| Category                                                                                                                   | Expected                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Short Ukrainian with 1 distinctive letter in an ordinary word ("Дрон має дальність польоту 250 км.")                       | `uk`, decisive under revision 2. Under revision 3 (B) it is non-decisive unless a channel-W marker is also present |
| Short Russian with ы/э/ъ/ё                                                                                                 | `ru`, decisive                                                                                                     |
| Ukrainian without distinctive letters ("Корисне навантаження становить 35 кг…")                                            | non-decisive (not a confident `ru`)                                                                                |
| Russian without distinctive letters                                                                                        | non-decisive                                                                                                       |
| Mixed: Russian quoting a Ukrainian name or place, and the reverse                                                          | the matrix language; decisive only if the evidence is unambiguous                                                  |
| Technical keys and English values ("max_speed 120 km/h", "Geran-2")                                                        | `unknown`                                                                                                          |
| Transliterated terms (`dalnost`, `maksimalnaya skorost`)                                                                   | `unknown` (not `en`)                                                                                               |
| Existing cases in `language-detect.test.ts`                                                                                | unchanged                                                                                                          |
| Russian starting with or mentioning Ukrainian names; Ukrainian starting with or mentioning Russian names (added in review) | never decisive in the wrong language                                                                               |
| Distinctive letter only in the first word, or only in quotations (added in review)                                         | non-decisive                                                                                                       |

### New metric: Language Detection Accuracy

- Reported in its own section, **never combined** with Resolution or Withholding Precision.
- Content:
  - a confusion matrix (en/ru/uk/unknown × expected);
  - the decisive rate;
  - **ru↔uk confusions among decisive results** (the critical cell);
  - for evaluation frames, declared-vs-detected agreement on rows that have a declared language.
- On the fixture corpus it is a **Tier-1 test (100 %)**. On real data it is an exploratory measure that needs human-labelled language. No language labels are fabricated.

### Approval criteria D0

Historical record for revision 2, kept unchanged. The current status is under "D0 status" below the revision 3 section.

Status 2026-11-26: implemented and committed (`a69ce6f`). **Not closed.** A second code review asked for adversarial tests against mixed-language text, and they found an open defect.

- **Corpus:** `src/test/fixtures/language-detect-corpus.ts`, 92 rows in 14 categories.
- **Name and first-word probes:** 0 of 17 decisive-wrong. These were written independently of the corpus.
- **Adversarial mixed-language set** (`src/test/language-detect-adversarial.test.ts`, written independently of the detector): **10 of 29 rows are false-decisive.**
  - Cause: one distinctive letter in one ordinary word is enough for a decisive result, and Russian or Ukrainian sentences often contain no distinctive letter at all.
  - Affected cases:
    - Russian with one Ukrainian word or typo: 2 of 6;
    - Ukrainian with one Russian word: 1 of 5;
    - a single switch of language form: 3 of 4;
    - several sentences that switch language: 4 of 6.
  - Short technical texts with model designations: 0 of 8.
  - The failing rows are `it.fails` tests, so the suite stays green and turns red when the rule is fixed.
- **The corpus criterion below is met on the corpus only.** Tier-1 (0 decisive ru↔uk confusions) is not met on the adversarial set. D0 stays open until the maintainer chooses a rule change and the set passes.
- **Still open:** declared-vs-detected agreement for evaluation frames is not yet wired into a report. It belongs with the v1.3.0 evaluation (E4).

- [x] D0-Q1 answered: option (a).
- [x] The corpus passes 100 %, with 0 decisive ru↔uk confusions. A property test asserts that a row whose distinctive letters are only in names, first words or quotations is non-decisive.
- [x] Schema tests:
  - declared vs detected language;
  - disagreement between the two (both kept, declared wins the stratum);
  - unknown language;
  - non-decisive detection;
  - a v1.2.0 directory with no new fields reads and verifies unchanged.
- [x] Both end-to-end provenance runs pass.
- [x] `cyrillic_undetermined` cases are logged with reason and counts only. Since package 1 (2026-11-27), `cyrillic_mixed` and `conflicting_evidence` are logged too, with the distinct evidence words and channels per language; text is never logged.
- [x] Existing `language-detect.test.ts` passes unchanged.
- [x] Translation-routing regression tests: `pairFor` gives `uk-en` for decisive Ukrainian; undecidable text behaves as decided in D0-Q1; English still short-circuits.
- [x] v1.2.0 S5 verification still passes. The command exits 0, and the committed directories are untouched.
- [x] `npm run green` shows no new findings.

### D0 revision 3: two evidence channels (design frozen 2026-11-26; implemented as detector 3.0.0 in `acb6384`)

Design review, 2026-11-26:

- **Approved:** the two channels, the threshold of two distinct evidence words, and choosing A or B on the development sets.
- **Changed:** як and становить removed from the marker list.
- **Frozen:** the design. The implementation introduces `LANGUAGE_DETECTOR_VERSION`.
- **Still deferred:** sentence-level classification.

Decided direction: alternatives 1 + 2 from the adversarial review. Sentence-level classification (alternative 3) is deferred until the results show it is needed.

**Principle.** A decisive stamp must be deserved. The aim is not to classify as many texts as possible. The **non-decisive rate is always reported next to the false-decisive count**, because a detector that classifies almost nothing would be safe but useless.

#### Channel L: distinctive letters (exists)

- An **evidence word** for a language is an ordinary word that contains a letter only that language has: Ukrainian іїєґ, Russian ыэъё.
- Ordinary means as today: not capitalised, not all-caps, not sentence-initial, not quoted.

#### Channel W: marker words (new, a separate evidence channel)

- **Source.** A closed, versioned list of high-frequency function words and verb forms that occur in only one of the two languages.
- **Separate from L.** A marker word **never contains a distinctive letter**. W therefore uses different features than L and can fire in text that L cannot see, so it is not a second way of counting the same letters. That makes the channels **separate**, not statistically independent: both are driven by the same underlying language.
- **Matching.** Case-insensitive, whole tokens only. Quoted text is excluded. A sentence-initial word counts, because function words are not names. Capitalised words in mid-sentence are still excluded.

| Russian-only markers (no ыэъё)                                                                                                                                                                            | Ukrainian-only markers (no іїєґ)                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| что, его, как, когда, только, сейчас, очень, даже, или, где, она, они, которая, которое, которого, сообщил, сообщила, сообщают, заявил, упал, летел, составляет, около, ночью, также, после, сегодня, нет | що, це, його, якщо, вже, дуже, або, але, вона, вони, був, була, було, який, якого, близько, також, мають, можна, ще, теж, чому |

The table shows the list of detector 3.1.0: 28 Russian and 22 Ukrainian markers. Detector 3.0.0 also had яка, яке, заявив and упав on the Ukrainian side (finding F1, removed in package 2).

**Excluded on purpose:**

- Words that occur in both languages or have common homographs: та, но, уже, коли, де, може, по, на, до, за, про, не, и/і.
- Words that are also Russian words: зараз (Russian "at one go"), треба (Russian "rite").
- Words that contain a distinctive letter, so they already belong to channel L: был, была, было (ы), летів, після, вночі (і).

- **Removed in design review:**
  - як: also the Russian noun "yak";
  - становить: also an older or less common Russian verb.
- **Removed in package 2 (3.1.0, finding F1):**
  - заявив, упав: also standard Russian perfective gerunds ("having stated", "having fallen");
  - яка, яке: also case forms of the Russian noun "як", for the same reason як was removed.
  - заявил and упал stay Russian markers: those forms are Russian only.

  A smaller, high-precision list is preferred over a larger one that needs exception logic.

- **Removed in implementation (correction of a design error, 2026-11-27):** має. It contains є, so it broke the list's own rule that no marker contains a distinctive letter. The implementer's enforcing test caught it. No replacement was added in the same change. має still counts as channel-L evidence where it is an ordinary word. The whole list was re-checked afterwards: every remaining marker has no distinctive letter and a documented check against the other language.

**List rules:**

- The list is frozen in code with a `LANGUAGE_DETECTOR_VERSION`. That version is stamped in every manifest that uses detection.
- Every word in the code list carries a documented reason, and a note that it was checked for use in the other language. A word without both is not in the list.
- A word is added only under the same rule, and only through a reviewed change that bumps `LANGUAGE_DETECTOR_VERSION`.
- **The list never grows from the holdout set** (see below).

#### Decision rule

1. Collect the distinct evidence words per language, over both channels: E_uk and E_ru.
   - Distinct means distinct normalised word forms. Two occurrences of что count once.
   - A word that is evidence in both channels counts once.
   - The report keeps three things apart: occurrences, distinct words, and channels that contributed.
2. **Conflict:** if both E_uk and E_ru are non-empty, the result is non-decisive. The reason is `cyrillic_mixed` when channel L conflicts, even if channel W conflicts too; otherwise it is `conflicting_evidence`. This wording was aligned with the code after the chain review (F5). The design said "only channel L", and the code and its comment were kept.
3. **Sufficiency:** decisive `uk` needs |E_uk| ≥ 2 distinct words and E_ru empty. Decisive `ru` is the mirror case.
4. **Absence is not evidence.** One word, no words, or a missing other-language signal can never make a result decisive.
5. **Non-decisive Cyrillic** keeps the pre-D0 language from the old full-text rule, so translation routing for it does not change.
6. **Variant A or B, decided on the development sets only, before the holdout is opened.**
   - A needs at least two distinct evidence words in total.
   - B needs at least two distinct evidence words in total, at least one from L and at least one from W.
   - The choice is the best balance between false-decisive results (target 0) and the non-decisive rate. **If A and B perform the same on the development sets, B is chosen**, because it requires support from both channels.
   - The choice and the development-set figures behind it are recorded here before the holdout run.
   - **Decided 2026-11-27: variant B, frozen.** Development sets only, one run each. The figures are shown with the erroneous marker має and without it:

     | Set                  | Variant | Decisive (with має) | False-decisive (with має) | Non-decisive (with має) | Decisive (without має) | False-decisive (without має) | Non-decisive (without має) |
     | -------------------- | ------- | ------------------- | ------------------------- | ----------------------- | ---------------------- | ---------------------------- | -------------------------- |
     | Corpus, 92 rows      | A       | 17                  | 0                         | 81.5 %                  | 17                     | 0                            | 81.5 %                     |
     | Corpus, 92 rows      | B       | 10                  | 0                         | 89.1 %                  | 9                      | 0                            | 90.2 %                     |
     | Adversarial, 29 rows | A       | 3                   | **1**                     | 89.7 %                  | 3                      | **1**                        | 89.7 %                     |
     | Adversarial, 29 rows | B       | 1                   | 0                         | 96.6 %                  | 0                      | 0                            | 100 %                      |
     - A's false-decisive row is the sixth language-switch row. B gives 0 false-decisive results on both sets, so it meets the target and A does not.
     - **B is conservative on purpose.** Its non-decisive rate is high. On the adversarial set it decides nothing, which is safe but has no coverage there.
     - **Reservation:** 0 false-decisive on the development sets is a property of those samples, not evidence of zero errors in real use. The holdout is run exactly once by an unexposed session. If B fails there, the rules are not adjusted and the same holdout is not reused as approval evidence.

#### Evaluation sets (kept apart)

| Set                                                                                                                                                                                                                                                                                                                                                                                                 | Role                    | May drive rule changes?                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Corpus (`src/test/fixtures/language-detect-corpus.ts`, 92 rows)                                                                                                                                                                                                                                                                                                                                     | development, regression | yes                                                                                                                                           |
| Adversarial review set (`src/test/fixtures/language-detect-adversarial.ts`: 29 rows at the 3.0.0 decision, 42 since package 1 added 13 other-Cyrillic rows)                                                                                                                                                                                                                                         | development             | yes. Its `it.fails` rows must turn into passing rows                                                                                          |
| **Independent holdout** (written 2026-11-26 by an isolated author who saw neither the detector, its corpus, nor this word list; `src/test/fixtures/language-detect-holdout.ts`, 147 rows in 12 categories: 50 ru, 51 uk, 14 en, 13 mixed, 19 other; 32 rows where no decisive claim is acceptable. Neither the word-list designer nor the implementer reads its texts before the single evaluation) | **approval only**       | **no.** Evaluated once, after the rule and the word list are frozen. A rule change prompted by a holdout failure retires that holdout version |

**Holdout exposure log** (kept so the holdout's independence can be judged):

| Date       | Who                                     | Exposure                                                                                                                                                                                                      | Consequence                                                                                                                                                                                                  |
| ---------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-26 | Holdout author (isolated agent session) | Wrote the texts                                                                                                                                                                                               | Did not see the detector, its corpus, the adversarial set or the word list                                                                                                                                   |
| 2026-11-26 | Session that designed the word list     | Structural check only: counts, labels, uniqueness. No text was printed or read                                                                                                                                | May not read the texts before the single evaluation                                                                                                                                                          |
| 2026-11-26 | External design reviewer                | **Unintentionally received the full file contents** in a tool result while fetching the branch's documents. States it will not use or analyse the texts and gave the implementation no holdout-specific hints | The holdout is **kept**: the word list was designed before the exposure, and neither the designer nor the implementer received the contents. **This reviewer takes no part in the final holdout assessment** |

**Rules for the single holdout evaluation:**

- It is run by a session that has not been exposed to the holdout texts.
- The implementer does not read the holdout file. The implementation brief forbids opening it.
- The result is reported as counts per category plus the ids of failing rows. Texts are shown only after the rule is frozen for this version.

**What is reported for every set and category:**

- rows;
- decisive count;
- false-decisive count;
- non-decisive rate.

**The six multi-sentence language-switch rows** are reported on their own. If 1 + 2 does not make them non-decisive, sentence-level analysis (alternative 3) is the next step.

#### Approval gate for revision 3

- [x] Rule and word list reviewed and frozen in design (2026-11-26).
- [x] `LANGUAGE_DETECTOR_VERSION` introduced in code (3.0.0, `acb6384`). The list in code carries a reason and a check of the other language for every word. The chain review found that check to be wrong for four words (F1, see "D0 status").
- [x] Variant chosen on the development sets and recorded with the figures: **B** (2026-11-27).
- [x] Corpus: 100 %, 0 false-decisive (`acb6384`).
- [x] Adversarial set: 0 false-decisive. All 10 `it.fails` rows pass and are converted.
- [x] **Holdout, evaluated once** on 2026-11-27 by an unexposed session. It ran `scripts/evaluate-language-holdout.ts` once (exit 0) with detector 3.0.0. Result: **0 false-decisive in 147 rows** (no ru↔uk confusion and no other wrong claim). 36 rows were decisive; the non-decisive rate was 75.5 %. Per category:

  | Category              | Rows | Decisive | False-decisive | Non-decisive |
  | --------------------- | ---- | -------- | -------------- | ------------ |
  | ru_natural            | 15   | 6        | 0              | 60.0 %       |
  | uk_natural            | 15   | 8        | 0              | 46.7 %       |
  | ru_short              | 11   | 2        | 0              | 81.8 %       |
  | uk_short              | 11   | 2        | 0              | 81.8 %       |
  | ru_with_uk_names      | 11   | 1        | 0              | 90.9 %       |
  | uk_with_ru_names      | 11   | 1        | 0              | 90.9 %       |
  | mixed_single_switch   | 12   | 2        | 0              | 83.3 %       |
  | mixed_multi_sentence  | 10   | 2        | 0              | 80.0 %       |
  | quotations            | 12   | 3        | 0              | 75.0 %       |
  | technical_short       | 16   | 0        | 0              | 100.0 %      |
  | english_with_cyrillic | 11   | 9        | 0              | 18.2 %       |
  | other_cyrillic        | 12   | 0        | 0              | 100.0 %      |
  - **What the result supports:** one sample of 147 hand-written rows with 0 false-decisive results. That is consistent with a low false-decisive rate. As a rough guide, the 95 % one-sided Clopper–Pearson upper bound is about 8 % among the 36 decisive rows and about 2 % over all rows. It does not prove zero errors in real use.
  - **Coverage is low:**
    - 20 of the 74 clearly Russian or Ukrainian rows (natural, short and named categories) are decisive.
    - Short technical text is never decisive.
  - **This holdout version is now used.** Any rule change made because of its results needs a new holdout version.

- [x] All D0 checks above re-run (`acb6384`): provenance, translation routing, end-to-end tests, v1.2.0 S5 (exit 0) and `npm run green`.
- [x] Language provenance and translation routing reviewed again (2026-11-27). The review was an independent end-to-end chain review by a fresh session that had not seen the holdout. Result: **PASS WITH FINDINGS**, F1–F7 (below). D0 is **not closed**.

### D0 status (2026-11-27)

| Version                               | Status                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| D0 3.0.0 (`acb6384`)                  | **Historically evaluated, with known risk F1.** The holdout result (0 false-decisive in 147) stands for 3.0.0 only.              |
| D0 3.1.0 (package 2)                  | **Technically verified (pending the technical review), not statistically approved.** It does not inherit 3.0.0's holdout result. |
| D0 3.1.0 after holdout v2 (package 3) | Can become statistically approved after one evaluation of an unused holdout.                                                     |

**Limitation that holds for every version:** D0 tells Russian from Ukrainian. It cannot decide whether a Cyrillic text is Russian or Ukrainian at all. Belarusian, Bulgarian and other Cyrillic text can get a false decisive `ru` or `uk`: 5 of 13 development rows do with both 3.0.0 and 3.1.0. These 5 stay in every report as known development failures. Holdout v1's 0 false-decisive (its other-Cyrillic category was 12 rows, 0 decisive) does not mean 0 errors for all Cyrillic languages.

**Chain-review findings and their handling.**

- **F1, should-fix (high), done in package 2 (3.1.0, see below).** заявив and упав are also standard Russian gerunds, and яка and яке are case forms of the Russian noun "як". Their documented cross-language check was wrong, and that is a design error. Two reproduced cases:
  - "Беспилотник, упав в поле, загорелся; … обломки і детали." gives a decisive `uk` (false);
  - "Губернатор, заявив об атаке, сообщил, что…" is non-decisive although it is clearly Russian.
- **F2–F4 and F6, done in package 1** (no detector change; `LANGUAGE_DETECTOR_VERSION` stays 3.0.0):
  - **F2:** `LANGUAGE_REASON_OUTCOMES` in `language.ts` defines, for each reason, the decisive value and the allowed languages. The schema 1.1.0 validator rejects any inconsistent combination. Tests cover the full matrix (9 reasons × 2 × 4; exactly 12 combinations pass) and a property test over the detector's own outputs.
  - **F3:** `riva.pairFor` logs every non-decisive Cyrillic result: `cyrillic_undetermined`, `cyrillic_mixed` and `conflicting_evidence`. Each log line has the counts, the distinct evidence words and the channels per language. Text is never logged.
  - **F4: verification of 1.1.0 directories** (`verifyLanguageProvenance`) requires:
    - `languageDetectorVersion` and the current `languageRule` in the manifest;
    - one schema version throughout;
    - consistent provenance fields;
    - an exact re-detection from each stored excerpt, **with the detector version the manifest is stamped with** (`LANGUAGE_DETECTORS_BY_VERSION`), never with the current one in its place.

    The result carries a replay status: `replayed`, `not_replayed` or `not_applicable` (1.0.0). When the stamped version is not available, the status is `not_replayed`, with a warning. `evaluate-semantic-registry` prints it and writes it at the top of a 1.1.0 report: "language replay: NOT PERFORMED … not reproduced". A historical 1.1.0 frame thus stays verifiable for consistency after a detector bump, but the report never claims to have reproduced it. Only the current detector is registered, because no committed frame carries an older stamp. A frozen copy is registered before an older-stamped frame has to be replayed. (The first version, package 1, ran the check only for the current version and otherwise raised a plain warning. It was changed after review on 2026-11-27.)

  - **F4: schema 1.0.0.** Directories verify exactly as before. A **new** 1.0.0 freeze of a row without `language` is refused, because 1.0.0 records no detector; use 1.1.0.
  - **F6:**
    - Under 1.1.0, detection runs on the stored, truncated excerpt, so it can be reproduced.
    - The evidence key is case-insensitive while detection is case-sensitive. A case-only difference that detects differently excludes the whole cluster as `conflicting_evidence_metadata`, which is conservative.
    - When stratum languages match, the dropped duplicate's detection fields are discarded.
  - **Other Cyrillic languages:** 13 development rows added (5 Belarusian, 8 Bulgarian). **5 are false-decisive with 3.0.0** (1 Belarusian as `uk`, 4 Bulgarian as `ru`, partly through the shared words але, або, или, около and как). They are pinned as `it.fails`. Russian and Ukrainian are the only supported languages; this is a known risk outside the two-language model. The adversarial set is now 42 rows, with 5 known false-decisive, all in this category. The original 29 rows remain at 0.
- **Package 2, detector 3.1.0 (2026-11-27).** заявив, упав, яка and яке were removed from the Ukrainian list. No marker was added, and the decision rule is unchanged. 3.0.0 (`b55ab34`) and 3.1.0 were compared on every development text. Every changed outcome traces to exactly one removed marker.
  - **Development texts:** the 92-row corpus, the 42 earlier adversarial rows, and two groups of new rows:
    - 13 rows in "Russian gerunds and Ukrainian homographs": the reviewer's 3 reproductions verbatim plus 10 rows by the implementer, partly variations of them;
    - 18 rows in "…, independent author", written by a separate session that saw only the four words and the reason for their removal. It saw neither the reproductions, the other rows nor the detector.
  - Changes from 3.0.0 to 3.1.0 by row set. Each cell counts rows (the removed marker that caused the change):

    | Change                                                      | Reproductions + implementer (13) | Independent author (18)       |
    | ----------------------------------------------------------- | -------------------------------- | ----------------------------- |
    | Fixed false-decisive (3.0.0 wrong, 3.1.0 abstains or right) | 2 (упав)                         | 0                             |
    | **New false-decisive**                                      | **0**                            | **0**                         |
    | Coverage lost (correct decisive → non-decisive)             | 0                                | **1** (упав, a Ukrainian row) |
    | Coverage gained (non-decisive → correct decisive)           | 1 (заявив)                       | 4 (заявив 2, упав 1, яка 1)   |
    | Decisive in both, language changed                          | 0                                | 0                             |
    | Reason only (spurious `conflicting_evidence` gone)          | 4 (заявив 2, упав 1, яка 1)      | 6                             |
    | Unchanged                                                   | 6                                | 7                             |

    The corpus and the 42 earlier adversarial rows have no transition. No marker was added to win back the lost row.

  - **Figures** (rows / decisive / false-decisive / non-decisive), 3.0.0 → 3.1.0:
    - corpus: 92 / 9 / 0 / 90.2 % → unchanged;
    - adversarial, all 73 rows: 73 / 15 / 7 / 79.5 % → 73 / 17 / 5 / 76.7 %;
    - the 5 remaining false-decisive rows are the Belarusian and Bulgarian rows (see the limitation above).
  - **Checks:** all tests and `npm run green` pass, S5 exits 0 for both evaluation directories, and the holdout file was not opened.
- **F5 and F7 (documentation), synced in this document:**
  - the decisive end-to-end sentence;
  - the corpus table note;
  - the revision 3 heading;
  - the version gate box;
  - where the resolver caller rule is documented;
  - the `cyrillic_mixed` wording.
- **Still open:**
  - The sampler report does not yet summarise `cyrillic_undetermined` counts per frame. Reasons are stored per example.
  - Declared-vs-detected agreement belongs with E4.

**Next:**

1. ~~Package 2 (3.1.0)~~: done (see above).
2. Technical review: full regression, replay, backward compatibility, and a new chain review.
3. **Package 3:** holdout v2 by an isolated author. Coverage includes:
   - Russian gerunds and Ukrainian homographs;
   - mixed Russian and Ukrainian;
   - short texts without distinctive letters;
   - natural Russian and Ukrainian;
   - English with Cyrillic model designations;
   - Belarusian, Bulgarian and other Cyrillic languages.

   The author gets no development rows or known failures. It is evaluated once by an unexposed session.

---

## D1 (P1): four safe improvements (resolver 1.3.0)

Requires D0 to be merged first, so that the v1.3.0 frame records language provenance. The rules do not depend on D0, because none of them is Ukrainian-scoped.

| Rule                                                                        | Class / scope                                 | RCA case | Why it is safe                                                            |
| --------------------------------------------------------------------------- | --------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| `fuel_capacity` → `capacity.fuel`                                           | **Class 2**, `unitDimension: "volume"`, `all` | 008      | Kg or a missing unit fail safe (`unresolved_context`); tested in memory   |
| `production_rate_monthly`, `monthly_production` → `production.rate_monthly` | Class 1, `all`                                | 010      | The period is stated in the term. Bare `production_rate` is **not** added |
| `максимальная_скорость` → `speed.max`                                       | Class 1, `ru`                                 | 012      | Literal translation of the existing `maximum_speed`                       |
| `мощность_двигателя` → `power.engine`                                       | Class 1, `ru`                                 | 015      | Literal translation of the existing `engine_power`                        |

- `SEMANTIC_RESOLVER_VERSION` becomes 1.3.0, and each rule gets a rationale.
- Tests are written **before** the rules (see §G of the RCA). Each rule gets:
  - a positive test, case and delimiter variants;
  - wrong-language and missing-language negatives (ru rules);
  - a unit negative (fuel);
  - collision probes: `максимальная_скорость_цели`, `скорость`, `крейсерская_скорость`, `мощность`, `мощность_передатчика`, `production_rate`, `fuel`, `fuel_consumption`.
- The new keys are added to `replay.ts` probe lists. The unchanged negative controls are `total_cost`, `programme_cost`, `project_cost`, `zorblax_rating` and the whole `UNKNOWN_PROBES` list.
- **Not in D1:**
  - `максимальна_швидкість` (uk) waits until D0 has been in place one cycle;
  - `потужність_двигуна` waits for a reviewed example.

**Approval criteria D1**

- [ ] INV-01…13 at 100 %.
- [ ] Every v1.2.0 seed key resolves exactly as before (a snapshot-diff test over all 37 rule keys).
- [ ] 0 new resolutions on rows whose blind verdict is not `resolve`.
- [ ] 0 resolved→withheld transitions.
- [ ] All negative controls unchanged.
- [ ] The v1.3.0 evaluation (§E) is produced and reviewed.

---

## D2 (P2): semantic decision on range (decision first, code later)

The deliverable is a **written policy**, not aliases. It specifies when a stated range may be classified as `range.max`, `range.operational`, `range.combat`, `range.combat_radius` or `range.ferry`, or must be withheld. Expressed as a decision table over the qualifiers present in key, label and unit:

| Evidence in key/label                                                 | Outcome (proposal for discussion)                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| "maximum / максимальная / максимальна"                                | `range.max`                                                                      |
| "operational / practical / операционная / практическая"               | `range.operational` (after the manifest wording is clarified)                    |
| "combat radius / радиус действия"                                     | `range.combat_radius`                                                            |
| "ferry / перегоночная"                                                | `range.ferry`                                                                    |
| bare "range / дальность / дальність / дальность полета", no qualifier | **withhold**: `unresolved_context` or Class 4 [`range.max`, `range.operational`] |

Steps:

1. A human **reviews demo-014 and demo-019 before the policy is fixed.** The new definition must not decide automatically which of the two earlier verdicts was right. The review is recorded as a new decision in the v1.3.0 directory; the v1.2.0 `decisions.jsonl` is never edited.
2. **Taxonomy change, approved in principle and gated separately.** Clarifying the manifest descriptions of `range.max` ("…operational or ferry range") and `range.operational` is its own decision point, never part of a resolver improvement. It changes `MANIFEST_HASH`. It requires:
   - a written rationale;
   - the definition before and after;
   - examples of what is included and what is excluded;
   - an assessment of overlap with neighbouring concepts (`range.combat`, `range.ferry`, `range.combat_radius`);
   - approved positive and negative tests;
   - a version bump of the canonical manifest;
   - historical decisions left unchanged.
3. Only then are aliases considered, in a separate change.

**Approval:** both cards are reviewed; the taxonomy change, if any, is approved on its own; the policy is approved by the maintainer; the policy treats English, Russian and Ukrainian identically.

---

## D3 (P3): context-dependent keys (investigation, no aliases)

Applies to `потолок` (demo-016), `двигун` (demo-020) and similar head-noun keys.

1. **Measure before acting.** On the historical frame, find how often `rawLabel` exists and how often the key is a head noun with the qualifier only in the excerpt. If labels exist, Class 3 `labelTokens` rules (already supported) can carry the qualifier without giving the resolver the excerpt.
2. **Candidate rules after review:**
   - `потолок` (ru) as **Class 4** [`altitude.max`, `altitude.service_ceiling`]: the term is recognised, the attribute is not, and it is reported as ambiguous instead of unknown;
   - `практический_потолок` (ru) → `altitude.service_ceiling`, Class 3.
3. **Upstream:** a proposal to the extraction owner to keep the qualifier in the key or label (_потужність двигуна_, not _двигун_). Outside the resolver.
4. **Explicitly not done:** a unit-guarded `двигун` → `power.engine`. It would reward a truncated key and create a Ukrainian rule with no English counterpart.

**Approval:** measurement report read; any Class 4 rule passes INV-02/05 and never resolves.

---

## D4: inventory and migration plan for the 76 legacy keys

Spec decision 1 (Option B) stays: one-by-one curation, never a bulk conversion.

- **Work:** a generated, reproducible inventory (script plus report under `scripts/output/`). Each of the 97 legacy exact keys that map to a manifest concept gets one class:

| Class             | Meaning                                                       | Example                                      |
| ----------------- | ------------------------------------------------------------- | -------------------------------------------- |
| `migrated`        | already in the seed (21)                                      | `max_speed`                                  |
| `migrate`         | stable, unambiguous; candidate for a curated rule with a test | `ferry_range`, `empty_weight`, `dive_speed`  |
| `migrate_guarded` | valid only with a Class 2 guard                               | `fuel_capacity` (volume), `mass` (mass unit) |
| `ambiguous`       | recognised term, attribute undetermined → Class 4 candidate   | `range`, `altitude`, `cost`                  |
| `superseded`      | better expressed by another concept or rule                   | to be determined per key                     |
| `never`           | legacy heuristic that should not survive                      | to be determined per key                     |

- Each row records the legacy behaviour, including label dependence (legacy often matched on the label, which the new resolver handles differently), a proposed class, rationale, and a reviewer field. **Classes are proposed by the tool and decided by a human.**
- **Output:** a prioritised backlog, so the legacy implementation no longer hides lost functionality.
- **Approval:** inventory reviewed; any `migrate` batch follows D1's rules (test first, one rule per reviewed key).

---

## D5: historical frame export (infrastructure for E2)

The export is infrastructure, not resolver logic. Above all it must be deterministic, reproducible and safe.

**Requirements:**

- **Frozen sampling frame.** Build it from the historical store, read-only. `verification_audit` is never read (D1 of the Phase 3.2 plan).
- **Population documented:** its size, the query or criteria, and the sampling method.
- **Reproducible draw:** a seeded draw, with the stratification fixed in advance (§E2 method).
- **Kept for every row:**
  - the original text (≤ 300-character excerpts committed; full frames stay out of git, D3 of the Phase 3.2 plan);
  - language provenance (schema 1.1.0);
  - source references.
- **Exclusions recorded** with a reason for every row that could not be included.
- **Manifest with content hashes**, in the existing format, extended for schema 1.1.0.
- **Never writes:** no rewrite of historical data or existing decisions. Read-only database access.
- **No resolver output in blind material.** The blind CSV keeps having no resolver or AI columns.
- **Exact re-creation.** The same database snapshot, seed and parameters give the same frame and draw.
  - Because the database is live, the **frozen export file and its hash** are the reproducibility anchor.
  - The manifest also records the snapshot boundary: cutoff timestamp, row count and a hash of the ordered source ids.
  - A re-export that no longer matches (for example after a renormalisation) is reported as a mismatch, never silently accepted.
  - **Content and order are both verified.** The same rows in a different order are not the same frozen artefact.
    - The export writes rows in one canonical order, defined in the manifest (for example by `exampleId`).
    - The file hash covers that ordered content.
    - Verification fails on a reordering, even when the downstream draw sorts ids itself (`drawSample` sorts by `exampleId` within each stratum before shuffling). The draw's own order-insensitivity is never relied on in place of an ordered, hashed export.

**Who:** the implementer is one agent session. The **code review is done by a separate session** that did not write the code. This session writes under the Opus model, so "Opus reviews" means a fresh Opus session, not this one.

**Approval:**

- [ ] Two exports from the same snapshot and parameters are bit-identical.
- [ ] Tests cover exclusions, the stratification replay and the hashes.
- [ ] No write path exists (verified by review and by the import-graph test).
- [ ] The blind export has no resolver columns.
- [ ] The independent review has signed off.

---

## E. v1.3.0 evaluation design

New directory `src/test/fixtures/semantic-eval-v1.3.0/`, with five distinct test sets reported in separate sections and never pooled:

| Set                      | Content                                                                                                                                                                                                | Status in the report                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| E1 Diagnostic regression | the nine RCA cases plus the other 15 v1.2.0 rows, using the **unchanged** v1.2.0 blind decisions                                                                                                       | "diagnostic, circular by construction"; per-example transition table v1.2.0 → v1.3.0 |
| E2 Held-out              | new examples **not seen** while designing the rules: ideally a fresh draw from the real historical frame, otherwise rows written by someone other than the rule author **before** the rules are frozen | the only set that can show generalisation; exploratory labels only                   |
| E3 Negative / ambiguous  | `UNKNOWN_PROBES`, cost controls, Class 4 terms, bare range terms, head nouns                                                                                                                           | must all stay unresolved (Tier 1, 100 %)                                             |
| E4 Language detection    | the D0 corpus plus declared-vs-detected agreement on E1/E2                                                                                                                                             | Language Detection Accuracy, its own section                                         |
| E5 Legacy parity         | the D4 inventory keys in classes `migrated`/`migrate`                                                                                                                                                  | parity is **not** correctness; reported as coverage only                             |

**Rules:**

- Report the same frame, seed and ceiling where comparability is claimed.
- Stamp the new snapshot hash.
- Report language both as declared and as detected.
- No metric may say "passed".
- **Blocking findings:**
  - any resolved→withheld transition;
  - any new resolution on a non-`resolve` blind verdict;
  - any E3 failure;
  - any decisive ru↔uk confusion in E4.

Without E2, v1.3.0 can show at most "no regressions plus fixed known cases", not "better", and the report must say so.

### E2 method (decided: stratified random draw from the historical store; human blind labels)

**Order, fixed:**

1. **Historical draw.** Examples are drawn by the D5 export and sampler. No resolver output influences which examples are chosen.
2. **Blind human review.** The human judges the original text and records the blind verdict, which is the primary label.
3. **Reveal.** Resolver output and any AI proposals are shown only now.
4. **Reveal review.** Disagreements are analysed. Any change is stored as `finalVerdict` / `revisedAfterReveal`, separately from the blind verdict. A revision never replaces the blind label (D6 of the Phase 3.2 plan).
5. **Freeze.** Dataset, decisions, sampling frame and manifest are versioned and hashed. Only then is v1.3.0 run against E2.

**Stratification.**

- The draw is a seeded **stratified** random sample over the strata **detected language** (en, ru, uk, unknown), with a minimum per language. Criteria are fixed in writing before the draw. A simple random draw could yield very few Russian or Ukrainian rows. Family is recorded and descriptive only. Details are in [semantic-resolver-v1.3.0-e2-sampling-design.md](./semantic-resolver-v1.3.0-e2-sampling-design.md).
- Allocation and any weights are recorded in the manifest.
- Language for stratification is the D0 detection: decisive languages are their own strata, and non-decisive rows go to `unknown`. D5 therefore depends on D0.
- **Resolver status is not a stratum for E2.** Stratifying on it would let the resolver under test shape its own test set. The status is computed only after the freeze.
- Consequence: the existing exact bound (§F of the Phase 3.2 plan) assumes resolver-status strata. For E2, a bound is valid only conditionally on the realised R/W counts per cell, and that needs its own written derivation and hand-computed tests before any bound is printed. Until then, E2 figures are descriptive only.

The table and rules below cover the fallback external pool. For the historical draw, the "find sources" step is replaced by D5.

| Step                                                                                                    | Responsible                                                                  |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Fix the sampling criteria in writing (languages, families, positive/ambiguous/negative mix, size, seed) | maintainer, **before** any collection                                        |
| Find sources and candidate attributes; extract excerpts and provenance                                  | an AI agent that has **not** seen the RCA, this plan or the v1.3.0 rule list |
| Stratified draw from the candidate pool                                                                 | deterministic sampler, with the fixed criteria and seed                      |
| Propose language, family and difficulty                                                                 | AI (proposals only)                                                          |
| **Gold labels**                                                                                         | human, **blind** (see below)                                                 |
| Freeze dataset and manifest (hashes, provenance, review history)                                        | deterministic tooling                                                        |
| Evaluate v1.3.0                                                                                         | the repository's normal evaluation                                           |

Rules:

1. **Preferred source: a seeded random draw from the app's own historical store.** It is the population the resolver will actually see, and a random draw has no human or AI selection bias. This requires the historical frame export, which does not exist yet. `verification_audit` is never read (D1 of the Phase 3.2 plan).
2. **Fallback or complement: an external source pool.** Possible sources are manufacturers' and official product documents, government and defence bodies, technical publications and established news outlets. Each source is recorded with URL, publication date, language and access date. Excerpts are ≤ 300 characters (D3 of the Phase 3.2 plan). Rows from this pool are **not** labelled `origin: "historical"`: they did not come from the app's store. They get **`origin: "external_source"`** (decided; part of schema 1.1.0), whether collected by hand or by AI. External rows are **never** counted in a historical population estimate. They may be used for supplementary diagnostics and for language and concept tests, reported in their own section.
3. **The collecting agent is isolated.** It gets a brief with only the fixed criteria. It is told not to read `docs/semantic-resolver-v1.2.0-false-withholding-rca.md`, this plan, or the resolver rule list. The session that wrote the RCA and this plan does **not** collect E2.
4. **Gold labels follow the existing blind-then-reveal protocol.** The human gives a blind verdict from the source text **before** seeing any AI proposal or resolver output (D6 of the Phase 3.2 plan: the blind verdict is the primary label). Only then are AI proposals shown. Two models may propose independently; their disagreement is a review signal, and model agreement never replaces human verification.
5. **Positive, ambiguous and negative examples** are all included. Language, family and difficulty are recorded. The set covers different ways of expressing the same property, and it is not nine rewrites of the known failures.
6. **Frozen before use, used once.** E2 is frozen and versioned before v1.3.0 is run against it. E2 is never used to tune aliases. A finding in E2 is documented. Any rule change motivated by E2 retires that E2 version as a generalisation test, and a new version or a separate holdout is needed.
7. If none of the above can be met, E2 waits. The same person or session never both designs the rules and writes the test material.

---

## Order and gates

```
G-0 test runner ─► D0 language (P0) ─► D1 four aliases (P1) ─► v1.3.0 evaluation (E1, E3, E4, E5; E2 when a frame exists)
                                   └─► D2 range policy (P2, decision) ─► (later) range aliases
                                   └─► D3 context-key measurement (P3)
                    D4 legacy inventory (parallel, no resolver change)
                    D0 ─► D5 historical export ─► E2 draw ─► blind review ─► reveal ─► freeze ─► E2 evaluation
```

## Explicitly out of scope for v1.3.0

- Gate 0 accepting `_`-delimited canonical ids.
- Cyrillic unit-suffix stripping.
- Any `uk` alias before D0 has been in place for one cycle.
- `двигун`.
- Aliases for bare range in any language.
- Bulk legacy migration.
- Production integration of the resolver.
- Any change to v1.2.0 fixtures, decisions or reports.

## Decisions (2026-11-26)

| #   | Question                                       | Decision                                                                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | What undecidable Cyrillic text returns (D0-Q1) | **Option (a).** Translation keeps today's behaviour; the resolver treats the language as unknown; never counted as a confident detection; logged as `cyrillic_undetermined`; uncertainty travels with the value between modules                                                           |
| 2   | Schema 1.1.0 provenance fields                 | **Approved:** `declaredLanguage`, `detectedLanguage`, `languageDetectionDecisive`, `languageDetectionReason`. Declared is never overwritten by detection. Backward compatibility is absolute                                                                                              |
| 3   | Who produces E2                                | **AI collects, a human sets the gold labels**, under the rules in §E2 method. An isolated agent collects; the human labels blind                                                                                                                                                          |
| 4   | May D2 change manifest descriptions?           | **Yes, with separate approval**, under the requirements in D2 step 2. demo-014 and demo-019 are reviewed by a human first                                                                                                                                                                 |
| –   | Added requirement                              | End-to-end language provenance check and test (D0)                                                                                                                                                                                                                                        |
| –   | Ordering                                       | **G-0 before everything else**                                                                                                                                                                                                                                                            |
| 5   | Origin for external-pool rows                  | **`external_source`**; never counted in a historical population estimate                                                                                                                                                                                                                  |
| 6   | Who builds the historical export               | **D5:** one session implements; a separate session reviews the code                                                                                                                                                                                                                       |
| 7   | E2 sampling                                    | **Stratified random draw from the historical store, strata = detected language only** (revised 2026-11-26, replacing language × family). Minimum m = 25 per language; n = 150 preliminary; family descriptive only; resolver status is not used for selection. See the E2 sampling design |
| 9   | Difference census                              | **Yes, separate from E2**: all rows where v1.2.0 and v1.3.0 differ, reviewed blind, with outputs shown as A/B in random order; never pooled with E2                                                                                                                                       |
| 8   | E2 gold labels                                 | **Human blind review before any reveal**; revisions after reveal are stored separately and never replace the blind label                                                                                                                                                                  |
| –   | E2 after freeze                                | **Untouched.** Using E2 results to change rules retires that E2 version; the next evaluation needs a new independent test                                                                                                                                                                 |

### Still open

- The E2 sampling design is decided at method level ([semantic-resolver-v1.3.0-e2-sampling-design.md](./semantic-resolver-v1.3.0-e2-sampling-design.md)). Still open: the final n and m, fixed from the D5 counts before the draw, and the seed commit before D5.
- The bound derivation for E2 (§6.3 of the sampling design). Until it exists and is tested, E2 reports no confidence bounds.
