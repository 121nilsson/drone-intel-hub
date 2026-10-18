# Spec: Utvärderingsläge för heuristikmotorn

**Status:** Implementerat (v1 + automation)  
**Fil:** `docs/EVALUATION_MODE.md`  
**Relaterad kod:** `src/features/evaluation/evaluation.ts`, `src/features/evaluation/evaluation-page.tsx`, `src/shared/infra/evaluation.server.ts`, `src/shared/infra/evaluation.functions.ts`, `src/test/eval-corpus.test.ts`, `src/test/eval-mismatches.test.ts`, `src/test/fixtures/eval-corpus.json`, `src/test/fixtures/eval-mismatches.json`, `src/test/fixtures/eval-catalog.json`

---

## 1. Bakgrund

Idag körs heuristikmotorn alltid först i `runTwoTier()` (pipeline.ts:406-409), men AI:n (`tier1`/`tier2`) förfinar nästan alltid resultatet därefter. Det innebär att man aldrig får se hur bra heuristiken är på egen hand — AI:n döljer både fel och brister.

Från den live-DB-analysen (2026-10-17) framkom flera problem som ett utvärderingsläge skulle kunna mäta:

- **Korsklasskontamination:** PAC-3/THAAD fick `altitude: 32–40 km` (target altitude) istället för fordons-takthöjd
- **Felaktig sammanslagning:** En Starlink-artikel auto-mergades in i drönaren "Lyutyi" via katalogaliaset "Февраль" (ryska för februari) + saknad stop-ord-vakt — inte generisk "БПЛА"-matchning
- **Pengar som strängar:** 32 olika `unit_cost`-format; `$832 мільйони` tolkas nu efter lexikon-arbetet, men legacy-verbatim-strängar migreras gradvis (v6-omkörning)
- **Spec-key-explosion:** 631 olika spec-nycklar, bara 22 används fler än 10 gånger
- **~3 450 discarded candidates (66,7 %):** varav ~1 797 (52 % av de kasserade) saknar systemnamn — andelen nameless har minskat efter A3-fixen (alias-vakt), vilket är en positiv signal

---

## 2. Syfte

Ett utvärderingsläge ska låta oss köra heuristikmotorn **isolerat från AI:n** på ett urval av redan bearbetade källor, för att mäta **överensstämmelse mot den lagrade kombinerade extractionen** per spec-nyckel — **utan att skriva något till databasen** (inga nya kandidater, inga dronspecs, inga sammanslagningar).

> **Viktigt:** AI är inte "fasit". `combineExtractions()` slår ihop heuristikens och AI:s specs i `engine: "combined"` — deterministiska fakta (tal) tas aldrig bort. Måtten ska därför kallas "överensstämmelse mot lagrad kombinerad extraction", inte "precision mot AI". För att göra rapporten tolkbar bör heuristik- och AI-ursprung spåras via `discoveredBy` (`"seed" | "ai" | "analyst"` i `spec-engine.ts`) så att evalen kan jämföra heuristiken mot AI-tillförda specs separat.

Resultatet är en rapport som visar var heuristiken är stark och var den sviker, så vi kan prioritera nästa kodändring.

---

## 3. Användning

Utvärderingsläget körs manuellt — **inte** som en del av den vanliga intake-pipelinen. Det påverkar inte `drones`, `candidates` eller `dispatches`.

> **Obs:** Repo:t har ingen `tsx`/`vite-node` i devDeps. CLI kräver ny devDep — repo-idiomet är en server-funktion (`*.server.ts` + dynamisk import) eller en admin-knapp. Föredra server-funktion + admin-knapp.

```
# Exempel (konceptuellt)
npm run eval:heuristic -- --sample 100 --output eval-report.json
```

---

## 4. Teknisk specifikation

### 4.1 Indata

- En lista med `Candidate`-objekt (från `candidates`-samlingen) med icke-tom `raw`. Kandidater med `status === 'discarded'` kan inkluderas för att mäta noise, men filtreras bort som default.
- Urvalet bör **stratifieras** på `status` och/eller `source` (kandidaten har ingen `platform`-fält) så att sällsynta klasser (CUAS, USV) inte missas
- **Obligatorisk stratifiering:** `quality.decision` (med fallback till `status` — `quality` finns bara på ~927 nyare rader) och **epok** (`metadata.promptVersion ?? "legacy"`). 647 kandidater (12,5 %) har NULL-metadata (legacy-era); utan epok-stratifiering blir rapporten ojämförbar.
- Katalog (`Drone[]`) för matchning av systemidentitet

Varje kandidat bär hela `Extraction` (heuristik + AI-förfining) plus den råa texten (`raw`), vilket gör att spec-anspråken kan kopplas direkt till källan.

### 4.2 Flöde

```
1. Välj ett stratifierat urval av kandidater (default 100)
2. För varje kandidat:
   a. Kör heuristic.extract(candidate.raw, catalog) — AI:n anropas INTE
   b. Kör normalizeExtraction() på heuristikens resultat så att normalized-fält finns (annars saknas canonicalValue)
   c. Jämför heuristikens specs mot kandidatens extraction.specs (AI-förfinat resultat)
   c. Jämför heuristikens system-identitet mot kandidatens extraction.systems / matchId
3. Beräkna precision och recall per spec-nyckel och per identitetsdimension
4. Samla mismatch-exempel för manuell granskning
5. Skriv rapport (konsol eller fil, aldrig databasen)
```

### 4.3 Read-only-kontrakt (invariant)

`evaluateHeuristic()` får **endast**:

- Anropa `heuristic.extract(raw, catalog)`
- Läsa `Candidate.extraction`, `Candidate.raw`, `Drone[]`

Den får **inte**:

- Anropa `drones.upsert()`, `candidates.add()`, `dispatches.update()` eller någon annan skrivning
- Anropa AI-providern (`tier1`, `tier2`)
- Ändra kandidatens status, matchId eller något annat fält

Detta säkerställer att utvärderingen är säker att köra även mot den live-DB:n.

### 4.4 Jämförelsesemantik — spec-nycklar

Två specs anses matcha enligt denna prioriterade ordning:

| Kriterium              | Beskrivning                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Normaliserad match** | Samma `semanticKey`, samma `normalized.canonicalValue` (inom 1% tolerans), samma `normalized.canonicalUnit` |
| **Semantisk match**    | Samma `semantic` (via `semanticKeyFor()`), samma värde/enhet                                                |
| **Rå match**           | Samma `key`, samma `value` (som sträng), samma `unit`                                                       |
| **Felaktig nyckel**    | Heuristiken hittade ett värde men under fel nyckel (annan `semantic`)                                       |
| **Miss**               | AI hittade ett värde som heuristiken missade helt                                                           |
| **Falskt positivt**    | Heuristiken hittade ett värde som AI inte hittade                                                           |

Normalisering använder `Extraction` fältet `normalized` (från `normalizeQuantity`) eller faller tillbaka på `parseMagnitude`/`parseNumber` om det inte finns.

**Parningsregler (one-to-one, greedy):**

1. Matcha först `exact` → `semantic` → `raw`; varje spec får matchas högst en gång (annars kan en heuristik-spec matcha flera AI-specs).
2. `range`: `canonicalValue` är `undefined` för `up to`/`80–120 km`. Jämför `range.min`/`range.max` individuellt med samma tolerans, eller klassificera skillnad i qualifier som `differentReading` (inte `miss`) — "up to 120 km" är en annan läsning än "120 km".
3. Legacy-nycklar (t.ex. `payloadCapacity` camelCase, enhet "tonne") normaliseras av `semanticKeyFor()`. Kör `semanticKeyFor()` på **båda** sidor så att jämförelsen sker på kanoniska semantiska nycklar, inte råa nycklar.

### 4.5 Jämförelsesemantik — systemidentitet

Utvärderingen mäter också identitetsförmågan separat:

| Mått                  | Beskrivning                                                      |
| --------------------- | ---------------------------------------------------------------- |
| **Name precision**    | Andel heuristik-namn som matchar AI-namn (exakt eller fonetiskt) |
| **Name recall**       | Andel AI-namn som heuristiken hittade                            |
| **MatchId precision** | Andel heuristik-`matchId` som stämmer med AI-`matchId`           |

> **Obs:** Identitets-recall är strukturellt partisk — AI:n släpper medvetet obekräftade heuristik-system ("National", "Ukrinform"). Låg recall är därför inte automatiskt ett fel.
> | **MatchId recall** | Andel AI-`matchId` som heuristiken hittade |
> | **Systems precision/recall** | Samma men för `extraction.systems[]` |

Identitetsjämförelse använder `phoneticKey()`/`nameKey()` från `name-key.ts` för fonetisk matchning, och `±1%` tolerans gäller numeriska `canonicalValue` (strängvärden som `guidance`/`engine` jämförs exakt).

### 4.6 Mått

Per spec-nyckel:

- **Precision** = träffar / (träffar + falskt positiva)
- **Recall** = träffar / (träffar + missar)

> Tolerans för numeriska värden: `max(1%, |a−b|)` (absolut epsilon för små värden), inte rent procentuellt — annars blir 1 % av 0,1 = 0,001.

- **F1** = 2 × precision × recall / (precision + recall)
- **Antal fall** = hur många kandidater som innehöll nyckeln i AI-resultatet

Per identitetsdimension (name, matchId, systems):

- Precision och recall som ovan

`totalItems` kan vara mindre än `sampleSize` om kandidater filtreras bort (tom `raw` eller `discarded`).

### 4.7 Rapportstruktur (JSON)

```json
{
  "generatedAt": "2026-10-17T22:00:00Z",
  "sampleSize": 100,
  "totalItems": 97,
  "stratification": { "outcome": { "queued": 40, "merged": 35, "promoted": 15, "discarded": 7 } },
  "summary": {
    "overallPrecision": 0.81,
    "overallRecall": 0.69,
    "overallF1": 0.75
  },
  "identity": {
    "name": { "precision": 0.88, "recall": 0.92 },
    "matchId": { "precision": 0.76, "recall": 0.71 },
    "systems": { "precision": 0.64, "recall": 0.58 }
  },
  "perKey": {
    "range": { "precision": 0.82, "recall": 0.74, "count": 43 },
    "speed": { "precision": 0.91, "recall": 0.68, "count": 31 },
    "unit_cost": { "precision": 0.45, "recall": 0.33, "count": 12 },
    "altitude": { "precision": 0.33, "recall": 0.21, "count": 8 }
  },
  "mismatches": [
    {
      "candidateId": "f30a9092-84d9-4f5b-9adf-e3d72625e48b",
      "source": "dronebomber|tg:dva_majors/100461",
      "specKey": "altitude",
      "heuristicValue": 40,
      "heuristicUnit": "km",
      "heuristicSemantic": "altitude.max",
      "aiValue": null,
      "aiUnit": null,
      "aiSemantic": null,
      "matchType": "falsePositive",
      "evidence": "engagement altitude of 40 km",
      "normalizedHeuristic": { "canonicalValue": 40, "canonicalUnit": "km" }
    }
  ],
  "topIssues": [
    "altitude: F1 0.26 — target altitude reads as vehicle ceiling",
    "unit_cost: F1 0.38 — unparseable strings (e.g. $832 мільйони)",
    "matchId: F1 0.73 — generic 'БПЛА' matched to wrong catalog entry"
  ]

> `topIssues` ska genereras regelbaserat (t.ex. nycklar med lägst F1), inte hårdkodas — annars blir rapporten inaktuell när felen fixas.
}
```

### 4.8 API (förslag)

```ts
// src/features/intake/evaluation.ts

export interface EvalMismatch {
  candidateId: string;
  source: string;
  specKey: string;
  heuristicValue: string | number | null;
  heuristicUnit: string | null;
  heuristicSemantic: string | null;
  aiValue: string | number | null;
  aiUnit: string | null;
  aiSemantic: string | null;
  matchType: "exact" | "semantic" | "raw" | "wrongKey" | "falsePositive" | "miss";
  evidence: string;
  normalizedHeuristic?: { canonicalValue: number; canonicalUnit: string };
  normalizedAI?: { canonicalValue: number; canonicalUnit: string };
}

export interface EvalIdentityResult {
  name: { precision: number; recall: number; count: number };
  matchId: { precision: number; recall: number; count: number };
  systems: { precision: number; recall: number; count: number };
}

export interface EvalKeyStats {
  precision: number;
  recall: number;
  count: number;
}

export interface EvalReport {
  generatedAt: string;
  sampleSize: number;
  totalItems: number;
  stratification: Record<string, Record<string, number>>;
  summary: {
    overallPrecision: number;
    overallRecall: number;
    overallF1: number;
  };
  identity: EvalIdentityResult;
  perKey: Record<string, EvalKeyStats>;
  mismatches: EvalMismatch[];
  topIssues: string[];
}

export async function evaluateHeuristic(
  candidates: Candidate[],
  catalog: Drone[],
  heuristic: IntelExtractor,
  opts?: {
    sampleSize?: number;
    seed?: number;
    stratifyBy?: ("outcome" | "source.platform" | "none")[];
  },
): Promise<EvalReport>;
```

---

## 5. Domän och ursprung (informativt, ej P/R)

Domän (`domain`) och ursprungsland (`origin`) bör ingå i rapporten som informativa fält (hög signal för framtida deployment), men **inte** som precision/recall-mått i v1 — de är för brusiga för att vara meningsfulla i v1.

---

## 6. Implementationsanteckningar

- **Read-only:** `evaluateHeuristic()` får bara anropa `heuristic.extract()` och läsa kandidater/katalog. Inga `upsert`, `add`, `update` eller `resolve`. Detta bör skrivas som en explicit invariant i koden (t.ex. en kommentar ovanför funktionen).
- **Återanvänd befintlig kod:** `semanticKeyFor()` från `semantic.ts`, `ExtractedSpecSchema` från `extraction.schema.ts`, `parseMagnitude`/`parseNumber` från `numeric.ts`.
- **Stöd för heuristik-endast:** Funktionen bör kunna köras även när AI-providern är nere, eftersom den bara använder heuristiken + redan lagrade AI-resultat i kandidaterna.
- **Testbar:** Skriv tester som kör `evaluateHeuristic()` på ett litet syntetiskt dataset med kända förväntade resultat. Inkludera "trap"-fall:
  1. Target altitude som tolkas som vehicle altitude ("engagement altitude of 40 km" → `altitude.max` istället för `altitude.target_max`)
  2. Pengar på flera språk ("$2 miljarder", "$2 млрд", "$2 мільйони")
  3. Generiskt systemnamn ("БПЛА") som inte ska matcha någon specifik katalogpost
- **Provenance:** Kör `normalizeExtraction()` på heuristikens resultat innan jämförelse. Spåra heuristik- vs AI-ursprung via `discoveredBy` (`"seed" | "ai" | "analyst"`) så rapporten kan visa vilka specs heuristiken själv hittade vs AI-tillförda.

---

## 7. Förslag till nästa steg

1. Implementera `src/features/intake/evaluation.ts` enligt specen ovan
2. Lägg till ett CLI-kommando eller en server-funktion för att köra utvärderingen
3. Kör utvärderingen mot den live-DB:n (3 170 dispatches, 1 632 processade, 4 646 kandidater)
4. Använd rapporten för att prioritera nästa heuristik-fix (t.ex. altitud-kontamination eller pengar)

---

## 9. Självlärande loop (mål)

Utvärderingen är inte bara ett mätverktyg — den är grunden för att systemet ska **lära sig bli bättre** över tid:

1. **Kör** utvärderingen mot live-data (eller ett urval).
2. **Exportera** överenskomna fall till `src/test/fixtures/eval-corpus.json` via "Ladda ner corpus" på `/evaluation`.
3. **Replay:** `eval-corpus.test.ts` kör heuristiken mot varje sparad rapport och kräver att alla förväntade värden fortfarande produceras.
4. **Fixa:** om en heuristik-ändring bryter ett test, justera koden (eller uppdatera corpus medvetet).
5. **Upprepa:** nya rapporter läggs till corpus, så regressioner fångas automatiskt.

På sikt kan samma loop driva automatiska förbättringar: analysera mismatch-mönster, föreslå lexikon-tillägg eller notAfter-ändringar, och verifiera via corpus-testerna.

---

## 8. Frågor till kollegan (GLM-5.3 Free)

- Är `normalized.canonicalValue/canonicalUnit` tillräckligt pålitligt för jämförelse, eller behöver vi en tolerans (t.ex. ±1%)?
- Ska utvärderingen också jämföra `components[]` och `payloads[]`, eller bara `specs[]` och identitet?
- Vilken stratifiering är mest värdefull: `outcome`, `source.platform`, eller båda?
- Bör rapporten också innehålla domän- och ursprungsidentifiering (domain/origin) precision/recall?
