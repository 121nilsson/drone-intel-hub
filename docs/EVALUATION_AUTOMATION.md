# Spec: Autonom utvärderingsloop (självlärande eval)

**Status:** Implementerat — Steg −1, 0, 1, 2, 3 och 4 (grundläggande) är implementerade. Steg 2–4 är grundläggande versioner (AI-adjudication, mönstergrävning UI, analytikerrättelser). Trust-filter och mismatch-forbid har korrigerats efter review.
**Fil:** `docs/EVALUATION_AUTOMATION.md` (tidigare felstavad `EVALUTATION_AUTOMATION.md`)
**Relaterad spec:** `docs/EVALUATION_MODE.md` (v1, implementerad) — detta dokument realiserar dess §9 (självlärande loop).
**Relaterad kod:** `src/shared/infra/evaluation/evaluation.ts`, `src/features/evaluation/evaluation-page.tsx`, `src/shared/infra/evaluation/evaluation.server.ts`, `src/shared/infra/evaluation/evaluation.functions.ts`, `tasks/evaluation/run.ts`, `tasks/evaluation/health.ts`, `tasks/evaluation/adjudicate.ts` (ej skapad — adjudication körs via server-funktion), `src/test/eval-corpus.test.ts`, `src/test/eval-mismatches.test.ts`

---

## 0. Driftmiljö (fastställd)

- **Primär databas: PostgreSQL i Docker** — lokalt via `docker-compose.yml` och i produktion på egen server. Schemat är portabel plain SQL i `/migrations` (monteras av docker-compose).
- Lovable Cloud är en sekundär väg (preview). Loopen ska fungera där via `DocumentStore`-kontraktet, men designbeslut optimeras för Postgres.
- **CI har ingen databas.** Allt som CI kör måste vara hermetiskt och incheckat i git.

---

## 1. Bakgrund — nuläge

Implementerat i v1:

- `/evaluation` kör read-only jämförelse (heuristik vs lagrad extraction) och exporterar corpus.
- `src/test/fixtures/eval-corpus.json` innehåller **50 godkända positiva fall**, `eval-mismatches.json` **50 negativa fall**, och `eval-catalog.json` finns.
- `eval-corpus.test.ts` passerar (50/50). `eval-mismatches.test.ts` fallerar 49/50 — se §2.1, det är ett tankefel i hur negativa fall skapats, inte en heuristikregression.

Implementerat:

1. Schemalagd mätning (cron 03:15) + manuell trigger via `/evaluation`.
2. Health-check (cron 03:45) med regression-larm.
3. Corpus-writer (harvest) + git-import + export-script.
4. AI-adjudication (max 10/körning) via server-funktion.
5. Mönstergrävning + förslag på `/evaluation` (Godkänn/Avvisa → `lexicon_overrides`).
6. Analytikerrättelser som träningsdata (origin `analyst`, auto-godkänd).

Kvar att automatisera:

1. Steg 2–4 är grundläggande versioner — behöver verifieras mot live-data och förbättras.
2. Trendhistorik-vy (rapporter över tid) saknas i UI.

> **Felaktigt tänk (v1 av detta dokument):** "Corpuset är tomt (`[]`), regressionssviterna hoppar över."
> **Så här bör det tänkas:** Corpuset finns redan och är värdefullt. Automationen ska _bygga vidare_ på de incheckade filerna, inte ersätta dem.

---

## 2. Rättelser — felaktigt tänk vs rätt tänk

### 2.1 Negativa fixtures (`forbid`)

> **Felaktigt tänk:** Varje mismatch mellan heuristik och referens blir en negativ fixture som _förbjuder_ heuristikens värde. "Mismatch där heuristiken är mer korroborerad än AI → negativ fixture."
>
> Resultat: när heuristiken hade rätt förbjöd testet det korrekta svaret. Därför är 49/50 i `eval-mismatches.test.ts` röda.

> **Så här bör det tänkas:**
>
> - Heuristiken har rätt i en konflikt → **positiv fixture (`expect`)** med heuristikens värde. Referensens fel loggas separat som AI/referensfel; det testas inte mot heuristiken.
> - Heuristiken har fel (verifierat) → negativ fixture (`forbid`) med det felaktiga värdet, **men** med `status = 'pending_fix'`.
> - När koden rättats och fixturen passerar → `pending_fix` → `approved`, och den blir ett aktivt regressionstest.
> - En test-svit får aldrig vara röd "by design". Kända, ej rättade fel är en arbetskö, inte ett test.

Åtgärd för befintlig fil: klassificera om `eval-mismatches.json` — fall där heuristiken hade rätt flyttas till `eval-corpus.json` som `expect`; verkliga heuristikfel markeras `pending_fix` och hoppas över av testet tills de är fixade.

### 2.2 CI läser inte från databasen

> **Felaktigt tänk:** "Corpuset bor i databasen, inte i git. Testerna läser godkända fixtures från DB (`loadApprovedCorpus()`); utan `DATABASE_URL` → `it.skip`."
>
> Problem: CI har ingen databas, så hela regressionssviten skulle tyst hoppas över. Ett rött test kunde dessutom betyda "datat ändrades" i stället för "koden regressionade".

> **Så här bör det tänkas — två lager:**
>
> | Lager          | Var                              | Körs av                                                      | Syfte                                          |
> | -------------- | -------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
> | **Hermetiskt** | `src/test/fixtures/*.json` i git | `bunx vitest run` i CI, alltid                               | Stoppar kodregressioner. Deterministiskt.      |
> | **Levande**    | `eval_corpus` i Postgres         | Schemalagd task + `bun run test:corpus-db` lokalt mot Docker | Växer automatiskt, mäter trend, föder förslag. |
>
> Flöde mellan lagren: godkända DB-fixtures **befordras** periodiskt till git via en exportknapp/skript som skriver JSON-filerna — en människa granskar diffen och committar. Ingen bot gör commits.

### 2.3 Lexikon-overrides får inte göra extraktorer asynkrona

> **Felaktigt tänk:** Lexikon-overrides "mergeas vid lexikon-inläsning" från DB — vilket i praktiken gör `extract()`/normalisering beroende av en async DB-läsning.

> **Så här bör det tänkas:** Extraktorer och normalisering förblir **rena, synkrona och deterministiska**. Servern laddar `lexicon_overrides` till en **oföränderlig snapshot** i minnet vid uppstart och efter varje godkännande/synk. Extraktorn får snapshoten som indata (eller läser den cachade). Testerna kör med TS-default eller en explicit fixture-snapshot — aldrig mot DB.
>
> **Nuläge:** Overrides lagras i `lexicon_overrides` och visas på `/evaluation`, men appliceras **inte** automatiskt i extraktorerna. Godkända overrides back-porteras manuellt till TS-lexikon (princip 1: systemet ändrar aldrig TS-kod eller git). Detta är medvetet — auto-applicering kräver en snapshot-mekanism som ännu inte är implementerad.

### 2.4 Regressionströsklar

> **Felaktigt tänk:** Samma tröskel 0.05 för både per-nyckel och total F1.

> **Så här bör det tänkas:** Totalen är ett medel över många nycklar och rör sig mindre. **Per nyckel: −0.05. Totalt: −0.02.** Nycklar med färre än 10 utvärderade fall rapporteras men larmar inte (för brusigt).

### 2.5 Auto-godkännande

> **Felaktigt tänk:** Otydligt vad som får auto-godkännas; adjudicerade fall "via Steg 3:s approve-knapp".

> **Så här bör det tänkas:**
>
> - Auto-godkänn **endast** positiva fall som klarar hela trust-filtret (§5.2).
> - Allt som innehåller `forbid`, allt från AI-domare (Steg 2) och allt från mönstergrävning (Steg 3) → `pending` / `pending_fix`, granskas på `/evaluation`.

### 2.6 Schemadetaljer

> **Felaktigt tänk:** `eval_corpus_version` som `bigserial` + "radera pending-versionen" vid ny observation — strider mot append-only, och versionsnumret säger inget om innehållet.

> **Så här bör det tänkas:** Pending-rader _ersätts_ via `status = 'superseded'` (ingen DELETE). Versionen är en monoton räknare som höjs i samma transaktion som godkännanden, och testsviten pinnar `corpus_version` vid start.

---

## 3. Principer

1. **Autonomi i datalagret, granskning i kodlagret.** Systemet får mäta, samla, klassificera och föreslå. Det ändrar aldrig `src/shared/infra/heuristics/**`, lexikon-TS-filer eller git.
2. **AI är inte fasit.** Referensen är lagrad kombinerad extraction stärkt med korroboration och evidens i råtext.
3. **Rätt svar är alltid `expect`.** `forbid` används bara för verifierade heuristikfel.
4. **Budgettak i alla autonoma steg** (mönster: `MAX_ADJUDICATIONS`, `LEARNED_NEGATIVE_REPEATS`).
5. **`evaluateHeuristic()` förblir read-only.** Bara orchestratorn skriver, i egna tabeller.
6. **Repeterbart.** Fast seed, stratifierat urval, pinnad corpus-version.

---

## 4. Datamodell (plain SQL i `/migrations`)

```sql
CREATE TABLE eval_reports (
  id             uuid PRIMARY KEY,
  generated_at   timestamptz NOT NULL,
  seed           int NOT NULL,
  sample_size    int NOT NULL,
  corpus_version int NOT NULL,
  report         jsonb NOT NULL
);

CREATE TABLE eval_corpus (
  id             text NOT NULL,          -- stabil EvalFixture.id
  version        int  NOT NULL,          -- 1,2,3… per id
  kind           text NOT NULL CHECK (kind IN ('positive','negative')),
  fixture        jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','pending_fix','approved','rejected','superseded')),
  origin         text NOT NULL CHECK (origin IN ('agreement','adjudication','pattern','analyst','git_import')),
  source_report  uuid REFERENCES eval_reports(id),
  observed_at    timestamptz NOT NULL,
  supersedes     int,
  decided_at     timestamptz,
  decided_by     text,
  PRIMARY KEY (id, version)
);

CREATE TABLE eval_corpus_version (
  version     int PRIMARY KEY,
  created_at  timestamptz NOT NULL,
  note        text
);

CREATE TABLE eval_lock (
  name        text PRIMARY KEY,
  held_until  timestamptz NOT NULL
);
```

Skrivregler: aldrig DELETE. "Radera" = `rejected`; ny pending-observation ersätter gammal via `superseded`. Vid första start importeras git-filerna med `origin = 'git_import'`, `status = 'approved'` så båda lagren börjar synkade.

---

## 5. Steg 0+1 — Schemalagd mätning och corpus-tillväxt

**Körning:** Nitro-task `tasks/evaluation/run.ts` (`evaluation:daily`, t.ex. `"15 3 * * *"`), förskjuten från `sources:sync`. Kan även triggas från `/evaluation`. Lås via `eval_lock` (CAS, mönster från `claimSlot()`). DB nere → hoppa över tyst med backoff.

### 5.1 Flöde

```text
1. Lås. Läs pinnad corpus_version.
2. Stratifierat urval (~200, seed=1) via DocumentStore.
3. evaluateHeuristic()  — ren TS, noll AI-kostnad.
4. Spara rapport i eval_reports; diff mot förra → regressionssignal (§2.4).
5. Skörda fixtures:
   - avtal som klarar trust-filter     -> positive, approved
   - konflikt där heuristik bevisat rätt -> positive, pending
   - verifierat heuristikfel           -> negative, pending_fix
6. Dedupe mot befintliga (samma innehåll → hoppa; nytt innehåll → ny version).
7. Höj corpus_version om något godkändes. Släpp lås.
```

### 5.2 Trust-filter

| Villkor                                               | Positiv                    | Negativ   |
| ----------------------------------------------------- | -------------------------- | --------- |
| Evidens finns bokstavligen i `raw` (normaliserat)     | krävs                      | krävs     |
| `raw` > 50 tecken                                     | krävs                      | krävs     |
| Kandidat ej `discarded`                               | krävs                      | krävs     |
| Korroborerat av ≥2 kandidater, samma kanoniska värde  | krävs för auto-godkännande | —         |
| Upphandlingsnycklar (`contract_value`, `*_funding` …) | uteslutna                  | uteslutna |
| Felet bekräftat av analytiker eller domare            | —                          | krävs     |

### 5.3 Budgettak per körning

- Max 25 positiva, 15 negativa nya fixtures; max 5 per `semanticKey`.
- Corpus-tak ~2 000 godkända, max 50 per spec-nyckel. Vid överskridelse markeras äldsta som `superseded` — aldrig en version som en sparad rapport pekar på.

---

## 5.4 Health-check (regression-larm, implementerat)

Utöver den schemalagda mätningen (§5) körs en **health-check** dagligen (03:45) som:

1. Kör `evaluateHeuristic()` mot ett nytt urval.
2. Jämför mot senaste `eval_reports`-rad.
3. **Larmar** (console.warn + detaljer) vid:
   - Total F1 sjunker > 0.02
   - Per-nyckel F1 sjunker > 0.05 (för nycklar med ≥10 fall)
   - Nya mismatch-mönster dyker upp
4. Sparar alltid rapporten i `eval_reports` för trendanalys.

**Kod:** `src/shared/infra/evaluation/evaluation.server.ts` (`runEvaluationHealth`), `tasks/evaluation/health.ts`, cron i `vite.config.ts`.

**Syfte:** Kombinerar CI (hermetiskt) med produktionsövervakning — regressioner fångas även mellan deployer utan git-commits.

---

## 6. Steg 2 — Kapad tvistlösning

Max 10 AI-domar per körning via `chatCompletion`-proxyn. Domaren får råtext + båda läsningarna och svarar `heuristic | ai | neither`.

- `heuristic` → **positiv** fixture med heuristikens värde, `pending`. _(Inte negativ — se §2.1.)_
- `ai` → negativ fixture mot heuristikens felvärde, `pending_fix`, samt positiv med AI-värdet om evidensen bär.
- `neither` → loggas som olöst.

Inget från domaren auto-godkänns.

---

## 7. Steg 3 — Föreslagna förbättringar, mänskligt godkända

1. Gruppera felmönster (specKey, evidens-n-gram, kontext).
2. Generera förslag: cue-regex, `notAfter`-fragment, magnitudterm, alias.
3. Verifiera i minnet mot urval + **hela** corpuset (git + DB). Behåll bara om mål-F1 förbättras och noll fixtures bryts.
4. Visa på `/evaluation` med Godkänn/Avvisa.
5. Godkännande (en transaktion): skriv `lexicon_overrides`, uppdatera minnes-snapshot (§2.3), flytta berörda `pending_fix` → testas igen.

Aldrig automatiskt: ändring av TS-kod eller git. Godkända overrides back-porteras till TS-lexikon manuellt.

---

## 8. Steg 4 — Analytikers rättelser som träningsdata

Rättelser på `/catalog` eller borttagna felmatchningar blir fixtures med `origin = 'analyst'` — högsta trust, får auto-godkännas.

---

## 9. Testinfrastruktur

| Kommando                 | Källa                           | Miljö                                |
| ------------------------ | ------------------------------- | ------------------------------------ |
| `bunx vitest run`        | `src/test/fixtures/*.json`      | CI + lokalt, alltid hermetiskt       |
| `bun run test:corpus-db` | `eval_corpus` (pinnad version)  | Lokalt/server mot Docker-Postgres    |
| `bun run eval:export`    | DB → `src/test/fixtures/*.json` | Människa granskar diff och committar |

Regler:

- Testerna kör bara `approved`. `pending_fix` hoppas över med tydligt namn (`it.todo`), aldrig rött.
- DB-sviten pinnar en `corpus_version` vid start och loggar den.

---

## 10. Drift

| Ämne                    | Lösning                                                      |
| ----------------------- | ------------------------------------------------------------ |
| Cron vs manuell körning | `eval_lock` CAS                                              |
| DB nere                 | Tyst överhoppning + backoff                                  |
| Volym                   | ~200 urval/dygn, 10 AI-domar/dygn, ~2 000 corpus-tak         |
| Read-only-invariant     | Endast orchestratorn skriver                                 |
| Radering                | Förbjuden — `rejected`/`superseded`                          |
| Lovable Cloud           | Samma tabeller via service-role server-funktioner; sekundärt |

---

## 11. Byggordning

| Steg   | Innehåll                                                      | Förutsättning |
| ------ | ------------------------------------------------------------- | ------------- |
| **−1** | Klassificera om `eval-mismatches.json` (§2.1) så CI blir grön | —             |
| **0**  | Schema, `eval_lock`, cron-task, `eval_reports`, trendvy       | −1            |
| **1**  | Corpus-writer, trust-filter, git-import, `eval:export`        | 0             |
| **2**  | Kapad tvistlösning                                            | 1             |
| **3**  | `lexicon_overrides` + snapshot + förslag                      | 1             |
| **4**  | Analytikerrättelser                                           | 1             |

---

## 12. Beslut (tidigare öppna frågor)

| Fråga                 | Beslut                                                        |
| --------------------- | ------------------------------------------------------------- |
| Postgres eller Cloud? | Postgres i Docker är primärt; Cloud stöds via `DocumentStore` |
| Hermetiskt lager?     | Ja, alltid. CI kräver aldrig DB                               |
| Auto-godkännande?     | Endast trust-filtrerade positiva + analytikerrättelser        |
| Cron-frekvens?        | Dygnsvis                                                      |
| Regressionströskel?   | −0.05 per nyckel (≥10 fall), −0.02 totalt                     |
| Corpus-tak?           | ~2 000 totalt, max 50 per spec-nyckel                         |
