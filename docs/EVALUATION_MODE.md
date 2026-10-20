# Utvärderingsläge för heuristikmotorn

**Status:** Implementerat. Manuell körning på `/evaluation`, schemalagd körning och hälsokontroll på servern, regressionskorpus i git och Postgres, analytikerverdikt som facit.  
**Fil:** `docs/EVALUATION_MODE.md`  
**Relaterade dokument:** `docs/EVALUATION_AUTOMATION.md` (v2, halvautonom loop), `docs/EVALUATION_FULL_AUTOMATION.md` (dynamiska regler, sandlåda, skuggläge, autokorrigering)  
**Relaterad kod:** `src/shared/infra/evaluation/evaluation.ts` (ren, read-only), `src/shared/infra/evaluation/evaluation.server.ts`, `src/shared/infra/evaluation/evaluation.functions.ts`, `src/features/evaluation/*`, `src/entities/drone/claim-review.ts`, `tasks/evaluation/{run,health}.ts`, `src/test/eval-corpus.test.ts`, `src/test/eval-mismatches.test.ts`, `src/test/fixtures/{eval-corpus,eval-mismatches,eval-catalog}.json`

---

## 1. Bakgrund

Heuristikmotorn körs alltid först i `runTwoTier()` (`src/shared/infra/ingest/pipeline.ts`), och AI:n (`tier1`/`tier2`) förfinar sedan nästan alltid resultatet. Man får därför aldrig se hur bra heuristiken är på egen hand: AI:n döljer både fel och brister.

Analysen av live-databasen 2026-10-17 visade de problem utvärderingsläget byggdes för att mäta (historik, siffrorna gäller den dagen):

- **Korsklasskontamination:** PAC-3/THAAD fick `altitude: 32–40 km` (målets höjd) i stället för farkostens takhöjd.
- **Felaktig sammanslagning:** en Starlink-artikel slogs automatiskt ihop med drönaren "Lyutyi" via katalogaliaset "Февраль" (ryska för februari) och en saknad stoppordsvakt.
- **Pengar som strängar:** 32 olika `unit_cost`-format.
- **Spec-key-explosion:** 631 olika spec-nycklar, bara 22 använda fler än 10 gånger.
- **~3 450 kasserade kandidater (66,7 %)**, varav ~1 797 utan systemnamn.

---

## 2. Syfte

Utvärderingsläget kör heuristikmotorn **isolerat från AI:n** på ett urval redan bearbetade rapporter och mäter överensstämmelse per spec-nyckel och för systemidentitet, **utan att skriva något** till katalogen, kandidaterna eller flödet.

> **AI är inte facit.** `combineExtractions()` slår ihop heuristikens och AI:ns specs och tar aldrig bort ett deterministiskt faktum, så den lagrade extractionen innehåller heuristikens egen utdata. Referensen är därför inte den lagrade extractionen rakt av:
>
> 1. Varje spec bär AI:ns dom över heuristikens observation (`provenance: "both" | "heuristic" | "ai"`, `src/entities/drone/extraction-gates.ts`). Ett värde AI:n strök (`"heuristic"`) räknas som avvisat, inte som träff.
> 2. En analytikers dom över det anspråk specen blev i katalogen väger tyngst, i båda riktningarna (§8).
>
> Måtten heter därför "överensstämmelse mot referensen", inte "precision mot AI".

Rapporten visar var heuristiken är stark och var den sviker, så att nästa kodändring kan prioriteras. Den är också grunden för regressionskorpuset (§6) och för regel-loopen i `EVALUATION_FULL_AUTOMATION.md`.

---

## 3. Användning

| Var                                    | Vad                                                                                                                                         |
| :------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| `/evaluation` → **Run evaluation**     | Körs i webbläsaren mot laddade kandidater och katalog. Urval 50/100/250/500, valfritt med kasserade kandidater, nytt slumpfrö varje körning |
| `/evaluation` → **Run on server**      | `runEvaluation()`: 200 kandidater, frö 1, sparas i `eval_reports`                                                                           |
| Schemalagt `evaluation:run` (03:15)    | Samma som ovan, varje natt                                                                                                                  |
| Schemalagt `evaluation:health` (03:45) | Hälsokontroll mot föregående rapport (§7)                                                                                                   |
| `/evaluation` → trendpaneler           | F1 över tid (de 20 senaste rapporterna) och per spec-nyckel (se §4.6, känd brist)                                                           |

Schemat ligger i `vite.config.ts` (`scheduledTasks`). Där finns också `evaluation:rules` (04:15) och `evaluation:shadow` (:35 varje timme), som beskrivs i `EVALUATION_FULL_AUTOMATION.md`.

**Webbläsare och server mäter inte exakt samma motor.** Servern kör med de aktiva dynamiska reglerna (`getOrRefreshRuleSnapshot()`). Webbläsaren har ingen regelsnapshot och kör med de statiska lexikonen. En skillnad mellan de två är därför inte i sig en regression.

Servern skyddar sina körningar med låset `eval_lock` (10 minuter), så att två körningar inte överlappar. Utan `DATABASE_URL` hoppar serverkörningarna över med orsaken "no database configured".

---

## 4. Teknisk specifikation

### 4.1 Indata

- **Kandidater** med minst 50 tecken `raw`. Kasserade kandidater utesluts om inte `includeDiscarded` anges.
- **Urval:** stratifierat på plattform × utfall (`quality.decision`, annars `status`), round-robin över hinkarna med en deterministisk PRNG. Samma frö ger samma urval.
  - **Känd brist:** plattformen läses ur ett prefix i `source` (`tg:` → `telegram`), men dagens källrader har formen `Outlet · https://…` och blir nästan alla `web`. I praktiken stratifieras urvalet därför bara på utfall.
- **Epok** (`metadata.promptVersion ?? "legacy"`) stratifieras inte, men räknas i rapporten, så att man ser om urvalet domineras av gamla kandidater.
- **Katalog** (`Drone[]`): används för identitetsmatchning och för att läsa analytikerns verdikt (§8).

### 4.2 Flöde

```
1. Välj ett stratifierat urval (default 100).
2. Läs analytikerns verdikt ur katalogen en gång (analystVerdicts).
3. För varje kandidat:
   a. heuristic.extract(raw, catalog) - AI:n anropas INTE
   b. normalizeExtraction() på resultatet, så att kanoniska värden finns
   c. jämför specs mot referensen (referenceSpecs: lagrade specs + provenance + verdikt)
   d. jämför namn och matchId mot den lagrade extractionen
   e. samla överenskomna fall som regressionsfall (§6.1)
4. Beräkna P/R/F1 per spec-nyckel, totalt och per identitetsdimension.
5. Returnera rapporten. Webbläsaren visar den, servern sparar den i eval_reports.
```

### 4.3 Read-only-kontrakt (invariant)

`evaluateHeuristic()` och allt i `evaluation.ts` får **endast**:

- anropa `heuristic.extract(raw, catalog)`
- läsa `Candidate.extraction`, `Candidate.raw` och `Drone[]` (inklusive anspråkens `review`)

De får **inte** skriva till något repository, anropa en AI-tier eller ändra en kandidat. Bara serverfunktionerna i `evaluation.server.ts` skriver, och då bara till utvärderingstabellerna (`eval_reports`, `eval_corpus`, `eval_corpus_version`, `eval_lock`).

### 4.4 Jämförelse: specs

Finansiella nycklar (`contract_value`, `*_funding`, …) jämförs inte; de routas ut till `procurements`. Alla nycklar mappas till kanonisk semantik med `semanticKeyFor()` på båda sidor. `cost.unit` jämförs på belopp (`money.amount`), utan valuta.

Parningen är en-till-en och girig, i den här ordningen:

| Utfall             | Villkor                                                                                           | Räknas som                  |
| :----------------- | :------------------------------------------------------------------------------------------------ | :-------------------------- |
| `exact`            | Samma semantik, samma kanoniska värde inom tolerans, samma kanoniska enhet, samma nyckel          | träff                       |
| `semantic`         | Som `exact` men under en annan nyckel med samma semantik                                          | träff                       |
| `differentReading` | Samma punkt, men en sida är ett intervall eller en gräns (`up to 120 km` mot `120 km`)            | träff, listas som avvikelse |
| `raw`              | Samma värde som sträng (skiftlägesokänsligt) och samma enhet, när de kanoniska värdena inte avgör | träff                       |
| `wrongKey`         | Exakt samma värde under en annan semantik                                                         | fp + fn                     |
| `rejected`         | Heuristiken ger ett värde som AI:n strök eller som en analytiker avvisat                          | fp                          |
| `falsePositive`    | Heuristiken ger ett värde som inte finns i referensen                                             | fp                          |
| `miss`             | Referensen har ett värde som heuristiken inte gav                                                 | fn                          |

Ett struket eller avvisat referensvärde räknas aldrig som träff, och att heuristiken inte längre ger det räknas inte som miss. Ett värde en analytiker bekräftat räknas som referens även om AI:n strök det.

**Tolerans:** `|a − b| ≤ max(1 % av det största av beloppen, 1e-6)` (`numbersClose`). Strängvärden jämförs skiftlägesokänsligt.

`differentReading` blir aldrig en dynamisk regel. Det är en parserdefekt som ska rättas i koden (`EVALUATION_FULL_AUTOMATION.md`, pelare 4).

### 4.5 Jämförelse: systemidentitet

| Mått        | Underlag                                                                             |
| :---------- | :----------------------------------------------------------------------------------- |
| **name**    | `name` + `systems[].name`, jämförda som mängder av fonetiska nycklar (`phoneticKey`) |
| **matchId** | `matchId` + `systems[].matchId`, jämförda som mängder                                |

> Identitets-recall är strukturellt partisk: AI:n släpper medvetet obekräftade heuristiksystem ("National", "Ukrinform"). Låg recall är därför inte automatiskt ett fel.

### 4.6 Mått

Per spec-nyckel (kanonisk semantik) räknas `tp`, `fp` och `fn` enligt tabellen i §4.4. En `wrongKey` ger fp på heuristikens semantik och fn på referensens.

- **Precision** = tp / (tp + fp), **Recall** = tp / (tp + fn), **F1** = 2PR / (P + R). Saknas underlag blir måttet 0.
- **summary** summerar alla nycklars tp/fp/fn.
- **topIssues** genereras: de fem nycklar med lägst F1 bland dem med minst tre fall, med en notering om felen främst är falska positiva eller missar.
- **mismatches** begränsas till fem exempel per nyckel och utfall (`maxMismatchesPerKey`).

`totalItems` kan vara mindre än `sampleSize` när det finns färre behöriga kandidater.

**Trender:** totaltrenden på `/evaluation` visar de 20 senaste rapporterna. **Känd brist:** trenden per nyckel (`getEvalKeyTrends`) hämtar de 20 _äldsta_ (`order by generated_at asc limit 20`) och slutar därför uppdateras när det finns fler än 20 rapporter.

### 4.7 Rapportstruktur

```json
{
  "generatedAt": "2026-10-20T03:15:00Z",
  "sampleSize": 200,
  "totalItems": 200,
  "stratification": {
    "platform": { "web": 196, "telegram": 4 },
    "outcome": { "auto-merged": 81, "queued": 64, "auto-promoted": 33, "merged": 22 },
    "epoch": { "drone-osint-v3": 171, "legacy": 29 }
  },
  "summary": { "precision": 0.81, "recall": 0.69, "f1": 0.75, "tp": 412, "fp": 97, "fn": 185 },
  "identity": {
    "name": { "precision": 0.88, "recall": 0.62, "f1": 0.73, "tp": 160, "fp": 22, "fn": 98 },
    "matchId": { "precision": 0.76, "recall": 0.71, "f1": 0.73, "tp": 120, "fp": 38, "fn": 49 }
  },
  "perKey": {
    "range.max": { "precision": 0.82, "recall": 0.74, "f1": 0.78, "tp": 31, "fp": 7, "fn": 11 }
  },
  "mismatches": [
    {
      "candidateId": "f30a9092-84d9-4f5b-9adf-e3d72625e48b",
      "source": "dronebomber · https://t.me/dva_majors/100461",
      "text": "…",
      "specKey": "altitude.max",
      "matchType": "falsePositive",
      "heuristicValue": 40,
      "heuristicUnit": "km",
      "referenceValue": null,
      "referenceUnit": null,
      "evidence": "engagement altitude of 40 km",
      "normalizedHeuristic": { "canonicalValue": 40, "canonicalUnit": "km" }
    }
  ],
  "topIssues": ["altitude.max: F1 0.26 — mostly false positives (fp 9, fn 2)"],
  "fixtures": []
}
```

Siffrorna är illustrativa. `fixtures` beskrivs i §6.1.

### 4.8 API (`src/shared/infra/evaluation/evaluation.ts`)

```ts
evaluateHeuristic(
  candidates: readonly Candidate[],
  catalog: Drone[],
  heuristic: IntelExtractor,
  opts?: {
    sampleSize?: number; // 100
    seed?: number; // 1
    includeDiscarded?: boolean; // false
    minRawLength?: number; // 50
    maxMismatchesPerKey?: number; // 5
    onProgress?: (done: number, total: number) => void;
  },
): Promise<EvalReport>;

comparableSpecs(e: Extraction): Norm[]; // utan finansiella nycklar, normaliserade
compareSpecs(heur: Norm[], ref: Norm[]): SpecComparison; // parningen i §4.4
analystVerdicts(catalog): AnalystVerdicts; // verdikt per källrad (§8)
referenceSpecs(c: Candidate, verdicts): Norm[]; // referensen för en kandidat
checkFixture(fx: EvalFixture, heuristic, catalog?); // { missing, missingNames, forbidden }
mismatchesToFixtures(mismatches, limit = 50): EvalFixture[]; // falsePositive → forbid
fixturesToCorpus(fixtures, existing = [], limit = 50): EvalFixture[]; // slås ihop på id
analystFixtures(candidates, verdicts): EvalFixture[]; // ur analytikerverdikt (§8)
analystCorpus(candidates, catalog, heuristic); // { positive, negative } för git-export
```

---

## 5. Domän och ursprung

Domän (`domain`) och ursprungsland (`origin`) mäts inte. De är för brusiga för precision/recall och används bara informativt i katalogen.

---

## 6. Regressionskorpus och självlärande loop

### 6.1 Var fallen kommer ifrån

Ett regressionsfall (`EvalFixture`) är en rapporttext med värden heuristiken ska ge (`expect`, `expectNames`) och värden den inte får ge (`forbid`).

| Källa                                | Hur                                                                                                                                   | Status                            |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------- |
| Överensstämmelse (`report.fixtures`) | Varje körning: kandidater där heuristik och referens är överens (`exact`/`semantic`), minst en evidens finns i texten, inte kasserade | —                                 |
| Skörd (`harvestCorpus`, server)      | Som ovan, men minst ett av värdena måste ges av ≥ 2 kandidater; högst 5 per nyckeluppsättning och 25 per körning; ny korpusversion    | `approved`                        |
| AI-adjudikering (`runAdjudication`)  | Upp till 10 konflikter per körning avgörs av tier-2-modellen med ett ord (`heuristic`/`ai`/`neither`)                                 | `pending`, negativa `pending_fix` |
| Kö-beslut (`recordAnalystFixture`)   | När en analytiker befordrar, slår ihop eller kasserar en kandidat i kön: ett positivt fall med kandidatens specs                      | `approved`                        |
| Anspråksverdikt (`analystFixtures`)  | Härleds live ur katalogens verdikt vid varje laddning, sparas aldrig (§8)                                                             | `approved`                        |
| Git-import (`importGitCorpus`)       | Filerna i `src/test/fixtures/` läses in i `eval_corpus`                                                                               | `approved`                        |
| Avvikelseexport                      | "Download mismatch-corpus": `falsePositive` → `forbid`, högst 50                                                                      | —                                 |

> **Känd brist:** kö-beslutet "Discard" sparar i dag också ett _positivt_ fall med alla kandidatens specs, alltså raka motsatsen till analytikerns beslut. Kö-fallen tar dessutom med specs som AI:n strök. Rättas separat; till dess är `origin = 'analyst'` i `eval_corpus` inte helt pålitligt.

`eval_corpus` har statusarna `pending`, `pending_fix`, `approved`, `rejected` och `superseded`. Sandlådan provkör mot `approved` och `pending_fix` (senaste versionen per id), git-filerna och de live-härledda anspråksfallen. Inget i gränssnittet godkänner i dag ett `pending`-fall, så AI-adjudikeringens positiva fall används inte förrän någon gör det i databasen.

### 6.2 Git-korpuset

Två filer replayas av vitest med `eval-catalog.json` som katalog och de statiska lexikonen (ingen dynamisk regel):

- `eval-corpus.json` → `eval-corpus.test.ts`: kräver att inga förväntade värden eller namn saknas.
- `eval-mismatches.json` → `eval-mismatches.test.ts`: kräver dessutom att inga förbjudna värden förekommer. Fall med `status: "pending_fix"` hoppas över.

Filerna skrivs bara för hand, via knapparna på `/evaluation`:

- **Download corpus:** körningens överenskomna fall plus analytikerns bekräftade värden, men bara de dagens heuristik klarar.
- **Download mismatch-corpus:** analytikerns avvisade värden (som `pending_fix` så länge heuristiken fortfarande ger dem) plus körningens falska positiva.
- **Download catalog:** katalogen som `eval-catalog.json`.

Automatiken skriver aldrig över eller tar bort git-fallen.

### 6.3 Loopen

1. **Kör** utvärderingen (manuellt eller nattligt).
2. **Granska** avvikelserna per nyckel på `/evaluation`, och döm enskilda anspråk på systemsidan (§8).
3. **Lås in** korrekt beteende: ladda ner korpus och checka in, eller låt skörden lägga det i `eval_corpus`.
4. **Förbättra:** rätta koden, eller låt regel-loopen föreslå, sandlådepröva och skuggköra en dynamisk regel (`EVALUATION_FULL_AUTOMATION.md`).
5. **Upprepa:** varje nytt fall gör att nästa regression fångas automatiskt.

---

## 7. Hälsokontroll

`runEvaluationHealth()` (`evaluation:health`, 03:45) kör en ny utvärdering, sparar den och jämför med föregående rapport:

- **Regression:** total F1 sjunker mer än 0.02, eller en nyckel med minst 10 fall tappar mer än 0.05 i F1.
- **Information:** antalet nya avvikelsemönster (kandidat + nyckel som inte fanns förra gången).

Hälsokontrollen loggar bara (`console.warn` vid regression) och ändrar ingenting. Kretsbrytaren som sätter regler i karantän är en egen mekanism; den jämför aktiva regler mot aktiva minus de senaste 24 timmarnas på samma urval (`EVALUATION_FULL_AUTOMATION.md` §6.1).

Eftersom referensen förbättras när nya kandidater med `provenance` och nya analytikerverdikt kommer in, kan total F1 flytta sig utan att heuristiken ändrats. En enstaka varning är därför inte i sig ett bevis på regression.

---

## 8. Analytikerverdikt som facit

AI:ns lagrade extraction är en modells åsikt. Det enda facit som inte är det är analytikerns dom över ett enskilt anspråk på systemsidan. Analytikern öppnar ett källchip under en spec och väljer **Correct**, **Wrong value**, **Wrong unit / parse** eller **Another system**, med valfritt rätt värde.

- **Lagring:** domen sparas på själva anspråket (`SpecClaim.review`, `src/entities/drone/claim-review.ts`), inte i en egen tabell, så att den fungerar i alla tre lagren (localStorage, PostgreSQL, Lovable Cloud). Den skriver aldrig om anspråket. Ett avvisat anspråk ligger kvar men räknas inte i konsensus. Ett rätt värde läggs till som ett eget bekräftat anspråk med källa `Analyst`.
- **Företräde:** analytikerns dom vinner över både motsägelsekontrollen (`adjudication`) och autokorrigeringen (`autoCorrection`). Kontrollens dom sparas bredvid, inte över, så att man kan mäta hur ofta modellen håller med en människa.
- **Överlever omanalys:** när en rapport analyseras om flyttas domen till det återskapade anspråket (samma post, samma mätning, samma värde). Annars skulle ett avvisat värde komma tillbaka som färskt belägg.

### 8.1 Hur domen når utvärderingen

Read-only-kontraktet (§4.3) gäller: domen läses ur katalogen, som utvärderingen redan får.

- **Referensen** (`referenceSpecs`): kandidatens lagrade specs, med analytikerns dom på det anspråk varje spec blev. Kopplingen sker via anspråkets källrad (= kandidatens `source`) och bara till kandidaten som matade just den katalogposten (`resolvedInto`/`matchId`). En rapport som nämner två system har en kandidat per system, och ett värde som avvisats som "Another system" på det ena kan vara rätt för det andra.
- Samma referens används överallt där heuristiken poängsätts: `/evaluation`, sandlådans F1-mätning, skuggpoängen, hypotesgeneratorn och `runAdjudication` (som därför aldrig frågar AI:n om ett värde en människa redan dömt).
- **Regressionsfall** (`analystFixtures`): per kandidat ett positivt fall `review-<id>` (bekräftade värden ska fortsätta hittas) och ett negativt `review-neg-<id>` (avvisade värden får inte komma tillbaka), i kanoniska enheter. De härleds vid varje laddning och sparas inte, så ett ångrat verdikt tar sitt fall med sig. "Another system" blir inget fall, eftersom ett fall kontrollerar hela textens utdata och värdet kan vara rätt för ett annat system i samma rapport.
- **Git-export** (`analystCorpus`): se §6.2.

Hur verdikten också styr motsägelsekontrollens och autokorrigeringens självständighet beskrivs i `EVALUATION_FULL_AUTOMATION.md` §6.2.

---

## 9. Avgjorda designfrågor

| Fråga                                                     | Beslut                                                                           |
| :-------------------------------------------------------- | :------------------------------------------------------------------------------- |
| Räcker `normalized.canonicalValue` för jämförelse?        | Ja, med relativ tolerans 1 % och absolut golv 1e-6 (§4.4)                        |
| Ska `components[]` och `payloads[]` jämföras?             | Nej, bara `specs[]` och identitet                                                |
| Vilken stratifiering?                                     | Plattform × utfall; epok räknas men stratifieras inte (§4.1)                     |
| Ska domän och ursprung mätas?                             | Nej (§5)                                                                         |
| Hur undviker vi att mäta heuristiken mot sin egen utdata? | AI:ns dom per spec (`provenance`) och analytikerns verdikt i referensen (§2, §8) |
| CLI eller serverfunktion?                                 | Serverfunktioner (`evaluation.functions.ts`) och Nitro-tasks; ingen CLI          |
