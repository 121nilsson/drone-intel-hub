# Spec: Autonom utvärderingsloop (självlärande eval)

**Status:** Utkast — ej implementerat. Till för granskning innan bygge.
**Fil:** `docs/EVALUATION_AUTOMATION.md`
**Relaterad spec:** `docs/EVALUATION_MODE.md` (v1, implementerad) — detta dokument är dess direkt fortsättning och realiserar dess §9 (självlärande loop).
**Relaterad kod:** `src/features/evaluation/evaluation.ts`, `src/features/evaluation/evaluation-page.tsx`, `src/test/eval-corpus.test.ts`, `src/test/eval-mismatches.test.ts`, `tasks/sources/sync.ts`, `src/shared/infra/sources/source-sync.server.ts`

---

## 1. Bakgrund

Dagens loop är manuell och bruten på tre ställen:

1. **Mätning är manuell** — utvärderingen körs bara när någon trycker "Kör utvärdering" på `/evaluation`.
2. **Corpus-exporten slutar i webbläsaren** — "Ladda ner corpus" skapar en Blob och ett syntetiskt `<a>.click()`. Människan måste själv lägga filen i `src/test/fixtures/`.
3. **Corpuset är tomt** — `eval-corpus.json` och `eval-mismatches.json` är båda `[]`, så regressionssviterna hoppar över (`it.skip`).

Målet är att utvärderingen ska köras, lära sig och växa **utan mänsklig ingripande i datalagret**, medan kodändringar och lexikonändringar fortsatt kräver granskning.

### 1.1 Kärnidé: corpuset bor i databasen, inte i git

I stället för att en bot checkar in uppdaterade fixture-filer (vilket skulle tvinga fram maskinella commits i en Lovable-anslutet repo) lagras corpuset som **versionerade rader i databasen**. Testerna läser godkända fixtures från DB:

- Hela loopen förblir data-driven — inga maskinella git-historikändringar.
- Varje observation är append-only och spårbar till den rapport som producerade den.
- Godkännande (approva) blir ett `UPDATE status` i samma transaktion som resten av förändringen — en audit trail, inte en commit.

Den enda kompromissen är hermetisk CI (se §7.3): ett rött test kan nu betyda "corpuset ändrades" i stället för "koden regressionade". Det hanteras genom versionspinnbarhet + en liten checked-in guld-standardfil.

---

## 2. Principer

1. **Autonomi i datalagret, granskning i kodlagret.** Systemet får själv mäta, samla corpus, klassificera tvister och föreslå förbättringar. Systemet får **inte** ändra `src/shared/infra/heuristics/**` eller lexikon-TS-filer på egen hand.
2. **AI är inte fasit** (oförändrad från EVALUATION_MODE.md §2). Referensen är den lagrade kombinerade extractionen, stärkt med korroboration — aldrig en enskild AI-läsning.
3. **Budgetkapar i alla autonoma steg**, mönstret från `MAX_ADJUDICATIONS` i `auto-triage.ts` och `LEARNED_NEGATIVE_REPEATS` i `pipeline.ts`. Varje steg som fattar beslut har ett max antal per körning.
4. **Read-only-invarianten består.** `evaluateHeuristic()` skriver fortfarande ingenting. Det är *orchestratorn* (ny kodbas) som persistensrapporter och corpus i egna tabeller — utanför eval-funktionen.
5. **Allt är repeterbart.** Fast seed, stratifierat urval, spolbar corpus-version: en rapport körd mot version N kan exakt återskapas.

---

## 3. Datamodell (plain SQL i `/migrations`, monteras även av docker-compose)

```sql
-- Append-only historik av utvärderingsrapporter (trendlinjen, Steg 0)
CREATE TABLE eval_reports (
  id             uuid PRIMARY KEY,
  generated_at   timestamptz NOT NULL,
  seed           int NOT NULL,
  sample_size    int NOT NULL,
  corpus_version int,                -- vilken corpus-version denna körning validerade
  report         jsonb NOT NULL      -- hela EvalReport (oförändrad struktur)
);

-- Corpuset: en rad per fixture-*observation*, versionerat
CREATE TABLE eval_corpus (
  id             text NOT NULL,      -- EvalFixture.id (stabil identitet, t.ex. "neg-<candidateId>-<specKey>")
  version        int NOT NULL,       -- 1,2,3… per id
  kind           text NOT NULL,      -- 'positive' | 'negative'
  fixture        jsonb NOT NULL,     -- EvalFixture som sådan
  status         text NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  source_report  uuid REFERENCES eval_reports(id), -- provenans
  observed_at    timestamptz NOT NULL,
  supersedes     int,                -- föregående version, eller NULL
  decided_at     timestamptz,        -- tidpunkt för godkännande/avslag
  PRIMARY KEY (id, version)
);

-- Monoton räknare: "corpus-version N" = N godkända rader vid det tillfället
CREATE TABLE eval_corpus_version (
  version     bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL,
  note        text
);
```

### 3.1 Val i schemat och varför

| Val | Motivering |
|-----|------------|
| **Append-only + `supersedes`, aldrig UPDATE-in-place** | En fixture som förändras (ny text för samma fälla) är en ny version, inte en redigering. Man kan alltid spela tillbaka exakt den corpus som en gammal rapport validerade mot. Audit trail utan git. |
| **`status: pending → approved`** | Autonomi med en ärlighetsfattning. Steg 1-avtal (trust-filterade) kan **auto-godkännas**. Allt från tvistlöstning (Steg 2) eller mönstergrävning (Steg 3) startar `pending` och går via approve-knappen. Avslagna rader står kvar för historiken men ignoreras av testerna. |
| **`source_report`** | Varje fixture är kopplad till rapporten som producerade den. När en fixture slutar sex månader senare kan man hämta ursprungsrapporten och mismatch-kontexten. |
| **`kind` på raden** | Positiva och negativa fixtures har samma `EvalFixture`-format (`expect` vs `forbid`) men differentierad auto-godkännandepolicy (§5.2). |

### 3.2 Skrivregler

- Uppdatering av corpus sker **endast** via den autonoma orchestratorn (Steg 1–3) och via approve/reject-knapparna på `/evaluation`.
- Inga rader tas någonsin bort. "Radera en fixture" = `status = 'rejected'`.
- Ett nytt observationsskenario för samma `id` som redan har en `pending` version: ersätt den pending-versionen (ta bort den) i stället för att stapla — pending är en arbetskö, inte historik.

---

## 4. Steg 0 — Mätning utan uppsikt (ingen beteendeförändring)

**Arbetsgång:** nytt Nitro-task + cron-rad.

1. Ny fil `tasks/evaluation/run.ts` med `defineTask({ meta: { name: "evaluation:daily" } })`, scheduleras via `scheduledTasks` i `vite.config.ts` (t.ex. `"15 3 * * *"` — förskjuten från `sources:sync` för att inte krocka).
2. Läser nyliga kandidater via `DocumentStore`-kontraktet, server-side med dynamisk import av `*.server.ts` (mönstret från `store.functions.ts`).
3. Kör `evaluateHeuristic()` headless — ren TS + heuristik, **noll AI-kostnad**, bryter inte read-only-invarianten.
4. Persistensar hela rapporten i `eval_reports` (skrivningen sker i orchestratorn, inte i `evaluateHeuristic`).
5. Diff mot föregående rapport → per-nyckel F1-deltan. Faller en nyckel mer än 0.05 eller overall F1 mer än 0.05 är det en regressionssignal som visas på `/evaluation` (trendvy).
6. Skriver `corpus_version` på rapportraden så varje mätning är förankrad i det corpus som då gällde.

**Detaljer:**

- Fast seed (t.ex. `seed = 1`) och stratifierat urval (~200) för jämförbarhet över tid.
- Konkurrensskydd kopierat från `claimSlot()`/`releaseSlot()`-idioten i `source-sync.server.ts` (CAS på `sync_state` eller en `eval_lock`-rad) så att cron-tick och manuell körning inte kan överlappa.
- Provider-outage-cooldown enligt samma mönster: om DB:n är nere nästa tick, hoppa över tyst.

---

## 5. Steg 1 — Automatisk corpus-tillväxt

Orchestratorn sköter corpuset i samma körning som mätningen.

### 5.1 Flöde

```
1. Kör evaluateHeuristic() på det stratifierade urvalet
2. Skörda "avtal" (agreements)  → positiva fixtures (EvalFixture med expect[])
3. Skörda hög-trust-mismatcher  → negativa fixtures (förväntad: heuristiken har rätt)
4. Sätt trust-filter (§5.2)
5. For varje fixture: skriv ny observation till eval_corpus (append-only)
   - Befintlig approved version med samma innehåll? -> hoppa (dedupe)
   - Befintlig version med samma id men nytt innehåll? -> ny version, supersedes
   - Annars: version 1
6. Öka eval_corpus_version med en rad
```

`fixturesToCorpus(fixtures, existing)` behålls som ren formaterings-/merge-logik; bara lagringsskiktet är nytt.

### 5.2 Trust-filter — vad som får bli fasit

AI:n är inte sanningsreferens, så inget blir en fixture enbart för att AI:n sa det:

| Villkor | För positiva fixtures | För negativa fixtures |
|----------|----------------------|----------------------|
| Evidence-braken passerade (spec-enheten förekommer bokstavlige i `raw`) | krävs | krävs |
| Värdet korroborerat av ≥2 kandidater med samma kanoniska värde | krävs | — |
| Kandidaten är inte `discarded` | krävs | krävs |
| Heuristik och AI **samma** läsning (avtal) | ja | — |
| Mismatch där heuristiken är mer korroborerad än AI | — | ja |
| Inga `pending`-konflikter (samma semantic + motstridiga värden i mängden) | krävs | krävs |

### 5.3 Budgetkapar (per körning)

- Max **25** positiva och **15** negativa nya fixtures per körning.
- Per-nyckelkvot: max 5 nya fixtures per `semanticKey` så att `range` inte tränger undan `unit_cost`.
- Hård tak på corpusets storlek (t.ex. 2 000 godkända rader): vid överskridelse prunes äldsta godkända versionerna (men **aldrig** en version som en sparad `eval_reports.corpus_version` pekar på — de är spolbara).

---

## 6. Steg 2 — Begränsad tvistlösning (adjudication)

Där heuristik och AI är oense och korroboration inte avgör, spänds en **kapad** AI-budget (t.ex. 10 per körning) genom den befintliga `chatCompletion`-proxy:n:

1. Billig domar-prompt får råtexten + båda läsningarna och svarar `"heuristic" | "ai" | "neither"`.
2. Vinnaren uppdaterar corpuset:
   - heuristik rätt → mismatchen blir en **negativ** fixture som pinnar AI-epokens misstag;
   - AI rätt → **positiv** fixture;
   - "ingen" → inget skrivs, mismatchen loggas som olöst.
3. Alla domar loggas (i `eval_reports.report`-json:en eller en `adjudications`-delmängd) för granskning.
4. Adjudicerade fixtures skrivs som `status = 'pending'` — de auto-godkänns **inte** i v1, utan går via Steg 3:s approve-knapp.

Detta är första steget där systemet aktivt avgör vad som är korrekt — därför kapat och loggat.

---

## 7. Steg 3 — Automatiskt föreslagna förbättringar, mänskligt godkända

### 7.1 Strukturell förutsättning: lexikon som data

Lägg till en `lexicon_overrides`-samling som mergeas vid lexikon-inläsning (`src/shared/lexicons/index.ts`): TS-filerna förbliver default/ fallback, override-lagret kommer från DB. Då blir godkännande av en förbättring en datarad — inget deploy, fullt spolbart.

### 7.2 Förslagskedja

```
1. Mina mismatch-mönster: falsePositive/wrongKey grupperade på
   (specKey, evidence n-gram, sammanhang före match)
   — t.ex. "engagement altitude of 40 km → altitude.max" är ett lärbart notAfter-mönster;
     "$832 мільйonи" är ett lexikon-luck-mönster
2. Generera ett förslag: kandidat cue-regexp / notAfter-fragment / magnitud-term,
   plus de konkreta mismatch-exempel som motiverade det
3. Verifiera i-minnet FÖRE föreslående: spela förslaget mot urvalet + hela corpuset.
   Behåll bara om mål-nyckelns F1 förbättras och noll fixtures bryts.
   De flesta förslag dör här — det är poängen
4. Yta överlevande förslag på /evaluation ("Föreslådda förbättringar") med
   Godkänn/Avvisa-knapp
5. Godkännande = ett transaktionellt val:
   - skriv override-raden till lexicon_overrides
   - godkänn de pending-fixtures som förslaget rör
   - logga beslutet (vem/vad/when) i samma audit-skick som §3
```

### 7.3 Aldrig automatiskt

- Systemet ändrar **inte** `src/shared/infra/heuristics/**` eller lexikon-TS-filer. Godkända overrides kan back-porteras till TS vid lugn stund.
- Inga förslag mergeas utan verifiering mot hela corpuset.

---

## 8. Steg 4 — Analytikers åtgärder som träningsdata (delvis finns redan)

`learnedNegativeKeys` (pipeline.ts) förvandlar redan analytikers kasseringar till kunskap. Utvidga samma idé:

- En analytiker som rättar ett spec-värde på `/catalog` eller rensar ett felaktigt `matchId` genererar en provenans-tagad händelse som utvärderingsorchestratorn matar tillbaka som fixture/anti-fixture — varje mänsklig korrektion spelas först för alltid efter.
- Korrektioner får `discoveredBy: "analyst"` och räknas som **högast** trust-nivå (högre än korroboration) i §5.2.

---

## 9. Testinfrastruktur

### 9.1 DB-lästa tester

Testerna läser godkända fixtures via en ny `.server.ts`-loader (vitest kör i Node och får importera den direkt):

```ts
// src/test/eval-corpus.test.ts (ny version)
const corpus = await loadApprovedCorpus(); // *.server.ts
if (!process.env["DATABASE_URL"] || corpus.fixtures.length === 0) {
  it.skip("eval corpus lever i DB — sätt DATABASE_URL", () => {});
} else {
  for (const fx of corpus.fixtures) {
    it(`${fx.source} (${fx.id.slice(0, 8)}) @v${corpus.version}`, async () => {
      const r = await checkFixture(fx, new HeuristicExtractor(1));
      expect(r.missing).toEqual([]);
      expect(r.missingNames).toEqual([]);
    });
  }
}
```

`eval-mismatches.test.ts` likadant (assertar `missing` och `forbidden` tomma).

### 9.2 Spolbarhet per körning

- `loadApprovedCorpus()` resolverar **en** corpus-version vid svitens start och låser alla fixtures till den — svitern är internt konsekvent även om cron-tasken skriver mitt under körningen.
- Varje testrun loggar den spinnade versionen. Ett nere­slag meddelar `corpus_version`, och "CI var röd på v47" är repeterbart: `WHERE id = … AND version <= …` rekonstruerar exakt v47.

### 9.3 Hermetisk lager (den kompromiss vi tar)

Corpuset i DB gör CI beroende av DB. För att behålla ett hermetiskt lager:

- Den **checked-in** `src/test/fixtures/eval-corpus.json` behålls, men fylls **manuellt** med handskrivna guld-standardfällor enligt EVALUATION_MODE.md §6 (target-altitude, flerspråkiga pengar, generiskt "БПЛА") — ett litet, stabilt, hermetiskt lager som alltid körs.
- DB-corpuset är det stora, levande lagret som växer automatiskt.
- Alternativ (diskuteras i granskning): helt släppa filen och acceptera att CI kräver `DATABASE_URL`.

---

## 10. Konkurrens, säkerhet och drift

| Ämne | Lösning |
|------|---------|
| Cron vs manuell körning | `claimSlot()`-CAS, mönstret från `source-sync.server.ts` |
| Kö-säkring av kandidater | `evaluateHeuristic()` läser bara — inga leases behövs |
| DB-nedtid vid tick | Tyst överhoppning + backoff, cooldown-mönstret från `runAutoSync` |
| Storlek | Stratifierat urval ~200 per dygn; AI-budget Steg 2 = 10/dygn; corpus-tak 2 000 godkända |
| Invariant-säkring | `evaluateHeuristic()` förblir read-only; endast orchestratorn skriver, i egna tabeller |
| Raderadering | Förbjuden — "radera" = `status = 'rejected'` |

---

## 11. Byggnadsordning och uppskattning

| Steg | Omfattning | Autonomi |
|------|-----------|----------|
| **0.** Cron-eval + `eval_reports` + trendvy | liten — mesta plumbling av befintlig kod (`evaluateHeuristic`, cron-task-mönstret) | handfri mätning |
| **1.** Server-side corpus-writer med trust-filter och kapar | liten (`fixturesToCorpus` + ny lagring) | självväxande regressionssvit |
| **2.** Begränsad tvistlösning | medel | självavgörande facit (kapad, loggad) |
| **3.** `lexicon_overrides`-samling + mönesgrävning + approve-knapp | stor | självförbättrande med mänsklig granskning |
| **4.** Analytikers korrektioner som träningsdata | medel | mänskliga rättelser spelas först för alltid |

Steg 0+1 är förutsättningen för allt annat — Steg 3:s verifiering är bara så god som corpuset som Steg 1 underhåller.

---

## 12. Öppna frågor för granskning

1. **CloudStore-vägen (utan `DATABASE_URL`):** Ska DB-corpuset även leva i Lovable Cloud-tabellerna, eller är Postgres-only acceptabelt för v1 med rent skip annars? Schemat ovan porteras åt båda hållen men CloudStore går via service-role serverfunktioner — något mer plumbing.
2. **Hermetiskt lager:** Behålls den checked-in guld-standardfilen (§9.3), eller accepterar vi att CI kräver `DATABASE_URL`?
3. **Auto-godkännande i Steg 1:** Ska trust-filterade avtal auto-godkännas (färre klick, mer autonomi) eller landa som `pending` med veckovis granskningskö (säkrare, långsammare)?
4. **Cron-frekvens:** Dygnsvist (rimligt med ~200 kandidater) eller var 6:e timme för snabbare trendlinje?
5. **Regressionströskel:** 0.05 F1-delta som regressionssignal — för stram eller för slak för den datamängd vi har?
6. **Corpus-tak:** 2 000 godkända rader — tillräckligt för de ~22 nycklar som används mer än 10 gånger?