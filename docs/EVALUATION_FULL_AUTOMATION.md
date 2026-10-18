# Spec & Guide: Helt autonom självförbättrande loop utan extern CI

**Status:** Teknisk specifikation och implementationsguide (v3 — reviderad efter arkitekturgranskning och djupanalys)  
**Fil:** `docs/EVALUATION_FULL_AUTOMATION.md`  
**Relaterade specifikationer:** `docs/EVALUATION_MODE.md` (v1, manuell utvärdering), `docs/EVALUATION_AUTOMATION.md` (v2, halvautonom loop med mänskligt godkännande)  
**Relaterad kod:** `src/features/evaluation/**`, `src/shared/infra/evaluation.*`, `src/shared/infra/heuristics/**`, `src/shared/lexicons/**`, `tasks/evaluation/**`

---

## 1. Vision och sammanfattning

Denna specifikation beskriver hur **Drone Intel Hub** uppnår **äkta runtime-autonomi**: en sluten, självförbättrande loop där systemet upptäcker sina egna heuristikfel, formulerar regelhypoteser, validerar dem i en intern sandlåda och driftsätter förbättringarna direkt i minnet — **helt utan att pusha git-commits, förlita sig på externa CI-pipelines (GitHub Actions) eller starta om applikationsservern**.

### 1.1 Evolutionen av utvärderingssystemet

| Egenskap | v1 (EVALUATION_MODE) | v2 (EVALUATION_AUTOMATION) | v3 (EVALUATION_FULL_AUTOMATION) |
| :--- | :--- | :--- | :--- |
| **Utvärdering** | Manuell via `/evaluation` | Nattlig cron (03:15 / 03:45) | Händelsedriven och schemalagd |
| **Regressionsprovning** | Manuellt körd Vitest | Hermetisk Vitest i git | **In-Process Sandbox** mot Postgres `eval_corpus` |
| **Förbättringsförslag**| Manuellt kodarbete | Mönstergrävning i UI (Godkänn/Avvisa) | **Autonom hypotesgenerering** via skyddad AI-loop |
| **Regelpersistens** | Hårdkodad i `.ts`-filer | Delad tabell (`lexicon_overrides`) | **Enhetlig tabell (`dynamic_rules`) för manuellt & autonomt** |
| **Driftsättning** | Git commit + PR + CI | Manuell omstart / ej kopplad | **Atomär In-Memory Hot Reload med versionssynk** |
| **Externt beroende** | Node/Vitest lokalt | Git + GitHub Actions CI | **Noll externa beroenden** (100 % inuti Docker/Postgres) |
| **Mänsklig roll** | Utvecklare kodar fix | Analytiker klickar godkänn | **Övervakare / Auditör** (undantagshantering & rollbacks) |

---

## 2. Varför extern CI och kodändringar är en flaskhals

I traditionell mjukvaruutveckling och i v1/v2 av detta system gäller principen:
> *"Autonomi i datalagret, granskning i kodlagret. Inga ändringar i `.ts`-filer utan en människa och en git-commit."*

Detta skapar tre allvarliga begränsningar i en domän som OSINT och drönarunderrättelser:
1. **Långsam anpassning till språklig drift:** När ett nytt system introduceras vid fronten (t.ex. en ny FPV-variant eller ukrainsk/rysk jargong) tar ledtiden från upptäckt via PR, review, CI, image-bygge och deployment timmar till dagar.
2. **Hög tröskel för mikrojusteringar:** Att lägga till en enda synonym (t.ex. ukrainska `"дальність"` som `range.max`) kräver samma tunga procedur som en hel refaktorisering.
3. **CI saknar databasaccess:** GitHub Actions kör hermetiskt utan produktionsdatabas. CI kan därmed bara testa gamla statiska fixtures som checkats in i git, inte den ständigt växande poolen av nya källor och avvikelser.

**Lösningen är inte att slopa testerna, utan att flytta testaren (CI) in i applikationens runtime.**

---

## 3. Kärnarkitektur: De fyra pelarna

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        RUNTIME SELF-IMPROVEMENT LOOP (NO CI)                          │
│                                                                                        │
│   ┌────────────────────────┐                   ┌───────────────────────────────────┐   │
│   │  1. Ingestion & Eval   │                   │    2. Hypothesis Generator        │   │
│   │  Kör heuristik isolerat│                   │    Kräver: korroborering,         │   │
│   │  och loggar avvikelser │──[ Verified Mis ]▶│    analytikerfacit eller struktur.│   │
│   │  i `eval_reports`.     │                   │    Sorterar bort parserdefekter.  │   │
│   └────────────────────────┘                   └───────────────────────────────────┘   │
│                ▲                                                 │                     │
│                │                                                 │ [ Candidate Rule ]  │
│                │                                                 ▼                     │
│   ┌────────────────────────┐                   ┌───────────────────────────────────┐   │
│   │  4. Hot Reload & Sync  │                   │    3. In-Process Test Sandbox     │   │
│   │  Multi-process synk    │◀──[ Promoted ]────│    Partitionerad körning mot      │   │
│   │  via rules_version.    │   (ΔF1 > 0 &      │    `eval_corpus` i Postgres.      │   │
│   │  Graceful fallback.    │    0 regressioner)│    Spärrar regressioner.          │   │
│   └────────────────────────┘                   └───────────────────────────────────┘   │
│                │                                                 │                     │
│                ▼                                                 ▼ [ Failed ]          │
│   [ Förbättrad Heuristik ]                             [ Quarantined / Rejected ]      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Pelare 1: Data-driven regelmotor & Multi-process synkronisering (Hot Reload)

Heuristikmotorn (`HeuristicExtractor`) måste förbli **synkron, ren och deterministisk**. Den får **aldrig** göra asynkrona databasanrop inuti `extract()`.

#### Enhetlig regelmodell (Inga dubbla tabeller):
Tidigare fanns ett utkast till `lexicon_overrides` och ett separat förslag om `dynamic_rules`. Vi **förenar dessa till en enda tabell: `dynamic_rules`**.
Både manuella analytikerrättelser från `/evaluation` och helautomatiska regler lagras i samma tabell och exekveras av samma regelmotor.

#### Minnes-snapshot och flermiljö-synkronisering:
1. **Regel-snapshot vid start:** Servern läser alla aktiva regler (`status = 'active'`) från tabellen `dynamic_rules` till ett oföränderligt objekt i RAM (`RuleSnapshot`).
2. **Kompilerad regelrepresentation:** Reglerna förkompileras till en intern lookup-struktur (Aho-Corasick / Trie för sökord och normaliserade token-mönster för kontext).
3. **Multi-process synk (Web vs Worker vs Tasks):**
   När en bakgrundstask eller en Nitro-task aktiverar en ny regel i databasen kan andra processer (t.ex. webbservern) inte veta om detta via ett lokalt funktionsanrop.
   - **Lösning:** Tabellen `dynamic_rules_version` håller ett monotont versionsnummer.
   - `getActiveRuleSnapshot()` kontrollerar versionsnumret med en kort, billig in-memory TTL (t.ex. 30–60 sekunder) eller lyssnar på Postgres `LISTEN/NOTIFY dynamic_rules_changed`.
   - Har versionsnumret ändrats laddas ett nytt `RuleSnapshot` atomärt in i minnet:
   ```ts
   // src/shared/infra/heuristics/rule-registry.server.ts
   let currentSnapshot: RuleSnapshot = emptySnapshot();
   let currentVersion = 0;
   let lastChecked = 0;
   const TTL_MS = 30_000;

   export async function getOrRefreshRuleSnapshot(): Promise<RuleSnapshot> {
     const now = Date.now();
     if (now - lastChecked > TTL_MS) {
       lastChecked = now;
       try {
         const [{ version }] = await db()`select coalesce(max(version), 0) as version from dynamic_rules_version`;
         if (version > currentVersion) {
           const rules = await db()`select * from dynamic_rules where status = 'active'`;
           currentSnapshot = compileRuleSnapshot(rules);
           currentVersion = version;
         }
       } catch (err) {
         // Graceful fallback: krascha aldrig vid DB-avbrott, behåll aktiv cache
         console.warn("[rule-registry] Failed to refresh snapshot from DB, keeping memory cache:", err);
       }
     }
     return currentSnapshot;
   }
   ```
4. **Graceful Fallback vid databasavbrott (Resiliens):**
   - Om databasen inte är konfigurerad eller är tillfälligt nere faller systemet mjukt tillbaka på senast kända RAM-cache eller direkt på de statiska grundlexikonen i källkoden.
   - Ingestion och extraktion kraschar aldrig på grund av databasfel i regellagret.
5. **Extraktorn förblir ren och synkron:** Extraktionspipelinen tar snapshot som argument:
   ```ts
   extract(raw: string, catalog: Drone[], rules: RuleSnapshot): Extraction
   ```

---

### Pelare 2: Domänspecifik regel-DSL med grammatisk flexibilitet

Automatiken får **aldrig** generera fri JavaScript-kod eller godtyckliga regexar. En fri LLM-genererad regex kan orsaka Catastrophic Backtracking (ReDoS) eller förstöra extraktionen med oavsiktliga sidoeffekter.

#### DSL-justeringar för flerspråkighet, fri ordföljd och böjningsformer:
1. **Obligatorisk språktagg:** Både cues, filter och stoppord måste ange språk (`"sv" | "en" | "ru" | "uk" | "all"`). Ett stoppord på engelska får aldrig dämpa ett likalydande ord på ukrainska/ryska.
2. **Token-avstånd i stället för strikt föregående ord:** I slaviska språk (ryska/ukrainska) är ordföljden friare än i engelska. Att kräva `preceding_word` missar ofta uttryck som *"высота поражения цели до 40 км"*. Därför definieras kontextfilter med ett **avståndsfönster inom samma mening** (`maxTokenDistance: number`).
3. **Böjningsformer och ordstammar (Stemming):** 
   Slaviska språk har rika kasus- och genusböjningar (t.ex. *"дальність"*, *"дальності"*, *"дальністю"*).
   Regler kan därför antingen ange en ordstam (`stem?: string`), eller en array med kända böjningsformer (`terms: string[]`), så att motorns Trie matchar samtliga varianter utan att kräva dussintals separata regler.

```ts
export type DynamicRule = 
  | AddCueRule
  | ContextFilterRule
  | AddAliasRule
  | AddStopwordRule
  | AddUnitScaleRule;

export interface AddCueRule {
  kind: "add_cue";
  id: string;
  semanticKey: string;           // t.ex. "range.max"
  language: "sv" | "en" | "ru" | "uk" | "all";
  terms: string[];               // t.ex. ["дальність польоту", "дальності польоту"]
  stem?: string;                 // t.ex. "дальн" för automatisk suffix-matchning
  confidence: number;            // 0.1 - 1.0
}

export interface ContextFilterRule {
  kind: "context_filter";
  id: string;
  semanticKey: string;           // t.ex. "altitude.max"
  language: "sv" | "en" | "ru" | "uk" | "all";
  action: "suppress" | "reroute";
  targetKey?: string;            // t.ex. "altitude.target_max" vid korsklasskontamination
  scope: "same_sentence" | "same_clause";
  position: "before" | "after" | "anywhere_in_scope";
  maxTokenDistance: number;      // t.ex. 1-4 tokens avstånd
  triggerWords: string[];        // t.ex. ["engagement", "target", "поражения", "ціль"]
}

export interface AddAliasRule {
  kind: "add_alias";
  id: string;
  targetDroneId: string;         // t.ex. "shahed-136"
  alias: string;                 // t.ex. "герань-2"
  language?: "sv" | "en" | "ru" | "uk" | "all";
}

export interface AddStopwordRule {
  kind: "add_stopword";
  id: string;
  terms: string[];               // t.ex. ["бпла", "беспилотник", "kamikaze"]
  language: "sv" | "en" | "ru" | "uk" | "all";
  scope: "system_name" | "manufacturer" | "spec_value";
}

export interface AddUnitScaleRule {
  kind: "add_unit_scale";
  id: string;
  unit: string;                  // t.ex. "млрд", "миллиард"
  multiplier: number;            // 1_000_000_000
  dimension: "currency" | "distance" | "weight" | "speed";
  language: "sv" | "en" | "ru" | "uk" | "all";
}
```

---

### Pelare 3: In-Process Test Sandbox & Partitionerad körning

Detta är systemets absoluta säkerhetsventil. Ingen regel tillåts någonsin nå `status = 'active'` utan att först genomgå ett automatiserat prov mot det historiska korpuslagret (`eval_corpus`).

#### Partitionerad testning (Skalning för stor korpus):
När `eval_corpus` växer mot 2 000+ fixtures blir en fullständig provkörning av alla artiklar för resurskrävande för interaktiva anrop. Sandlådan använder därför en **tvåstegsmodell**:
1. **Snabb sandlåda (för interaktivt UI / snabbvalidering, < 1 sekund):**
   - **100 % täckning av berörd domän:** Alla fixtures i `eval_corpus` som innehåller den aktuella `semanticKey` (t.ex. alla fixtures med `altitude`).
   - **Kontrollstickprov:** Ett deterministiskt stratifierat stickprov på 100 orelaterade fixtures för att upptäcka oväntade sidokollisioner.
2. **Full sandlåda (nattlig autonom körning):**
   - Kör **samtliga** godkända fixtures i `eval_corpus` (100 % täckning).

```ts
// src/shared/infra/evaluation/sandbox-evaluator.server.ts
export async function evaluateCandidateInSandbox(
  candidate: DynamicRule,
  mode: "quick" | "full" = "full"
): Promise<SandboxResult> {
  const fixtures = mode === "quick" 
    ? await loadPartitionedFixtures(candidate.targetKey)
    : await loadApprovedCorpusFixtures();
    
  const testSnapshot = compileSnapshotWithRule(currentSnapshot, candidate);
  let regressions = 0;
  const brokenIds: string[] = [];

  for (const fx of fixtures) {
    const res = await checkFixtureWithSnapshot(fx, testSnapshot);
    if (res.missing.length > 0 || res.forbidden.length > 0) {
      regressions++;
      brokenIds.push(fx.id);
    }
  }

  // Hård spärr: noll regressioner tolereras
  const passed = regressions === 0;
  return { passed, regressions, brokenIds, testedCount: fixtures.length };
}
```

#### Hårda godkännandevillkor (Invarianter):
- **Noll regressioner ($\text{regressions} == 0$):** Inte en enda godkänd fixture i `eval_corpus` som tidigare fungerade får ge fel svar eller missas.
- **Positiv effekt ($\Delta \text{F1} > 0$):** Regeln måste faktiskt öka precision/recall eller eliminera den observerade avvikelsen.
- **Ingen global degradering:** Total F1 över testkorpuset får inte minska med ens $0.001$.

---

### Pelare 4: AI-hypotesgenerator & Anti-förgiftningsskydd

#### Skydd mot dataförgiftning ("AI är inte facit"):
Om hypotesgeneratorn automatiskt läser en mismatch mellan heuristik och AI från en oadjudikerad artikel, och AI:n i själva verket hallucinerade eller läste fel siffra i artikeln, kommer generatorn att formulera en regel som **tvingar heuristiken att producera samma fel som AI:n**.

En avvikelse (`EvalMismatch`) får **endast** användas som underlag för en hypotes om den uppfyller minst ett av följande tre kriterier:
1. **Analytikerverifierad (`origin = 'analyst'`):** En människa har markerat vad som är sant och falskt via gränssnittet.
2. **Källkorroborerad konsensus:** Värdet bekräftas av $\ge 2$ oberoende källor i databasen med samma kanoniska värde.
3. **Strukturell eller semantisk kollision:** Avvikelsen beror på ett entydigt och strukturellt mönster:
   - Ett generiskt stoppord som felaktigt tolkats som systemnamn (t.ex. `"БПЛА"`, `"FPV"`).
   - En känd felklassning med stark språklig signal (t.ex. `"engagement altitude"` eller `"ceiling of target"` som tolkas som drönarens egen altitud).
   - Valutasymboler eller enhetsmagnituder som saknats i lexikonet (t.ex. ukrainska förkortningar för miljoner/miljarder).

#### Särskiljning av Parserbuggar vs Regelfel:
Vissa avvikelser beror inte på ord eller sammanhang, utan på brister i underliggande numeriska parsers (t.ex. `parseNumber` som misslyckas vid tusentalsavgränsare som `1,500 km`, eller felaktigt tolkade intervall `80–120 km`).
- Om en avvikelse beror på numerisk formatering (`matchType === 'differentReading'`) ska **ingen dynamisk regel skapas**.
- Fallet klassificeras i stället automatiskt som `parser_defect` och skickas till en kö för mänsklig buggfix i källkoden. Detta hindrar automatiken från att bygga instabila "fulhack" runt kodbuggar.

---

## 4. Livscykel och tillståndsmaskin för regler

```
             ┌─────────────────────────┐
             │       Hypothesis        │
             │ (filtrerat underlag)    │
             └────────────┬────────────┘
                          │
                          ▼
             ┌─────────────────────────┐
             │    evaluating_sandbox   │
             │ (provkörs mot korpus)   │
             └──────┬────────────┬─────┘
    Passerar prov   │            │  Misslyckas / Regresserar
    (ΔF1 > 0, 0 fel)│            │
                    ▼            ▼
       ┌────────────────┐   ┌────────────────┐
       │     active     │   │    rejected    │
       │ (i RAM-cache)  │   │  (arkiverad)   │
       └───────┬────────┘   └────────────────┘
               │
   Hälsolarm mot rullande produktionsdata
   (dygnsmätning i tasks/evaluation/health.ts)
               │
               ▼
       ┌────────────────┐
       │   quarantined  │
       │ (avaktiverad)  │
       └────────────────┘
```

### Tydliggörande av Circuit Breaker (Rollback-metrik)
I specifikationen anges:
> *"Om total F1 sjunker med mer än 0.02 sedan föregående dygn... sätts senaste regeln i `quarantined`."*

**Viktigt förtydligande gällande dataset:**
- Minskningen kan **inte** uppstå mot `eval_corpus`, eftersom sandlådan garanterar noll regressioner mot korpuset innan regeln aktiveras.
- Minskningen mäts mot den **rullande produktionsevalueringen** ([tasks/evaluation/health.ts](file:///C:/dev/drone-intel-hub/tasks/evaluation/health.ts)), som varje natt (03:45) drar ett stratifierat stickprov på 200 **nya inkommande artiklar/kandidater** i produktion.
- Om F1 mot de nya produktionskandidaterna plötsligt viker kraftigt indikerar det att en nyligen införd regel har överanpassats (*overfitting*) mot testkorpuset på bekostnad av verkliga artiklar.
- Åtgärd: De regler som aktiverats under de senaste 24 timmarna sätts i `status = 'quarantined'`, `dynamic_rules_version` räknas upp och systemet rullar tillbaka till den tidigare stabila minnescachen.

---

## 5. Datamodell i PostgreSQL

Vi ersätter `lexicon_overrides` med en sammanhållen, framtidssäker tabellstruktur i en ny migration (`010_dynamic_rules.sql`):

```sql
-- Enhetlig tabell för ALLA dynamiska regler (både manuella och autonoma)
CREATE TABLE dynamic_rules (
  id           text PRIMARY KEY,
  version      int NOT NULL DEFAULT 1,
  kind         text NOT NULL CHECK (kind IN ('add_cue', 'context_filter', 'add_alias', 'add_stopword', 'add_unit_scale')),
  language     text NOT NULL DEFAULT 'all',
  payload      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'candidate' 
               CHECK (status IN ('candidate', 'evaluating', 'active', 'rejected', 'quarantined', 'superseded')),
  origin       text NOT NULL CHECK (origin IN ('analyst', 'autonomous_sandbox', 'bootstrap')),
  target_key   text,          -- t.ex. 'range.max' eller drönar-ID för snabb indexering
  rationale    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  promoted_at  timestamptz,
  decided_by   text NOT NULL  -- 'analyst' eller 'autonomous_sandbox'
);

-- Monoton versionsräknare för multi-process-synk (web/worker)
CREATE TABLE dynamic_rules_version (
  version      int PRIMARY KEY,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  note         text
);

INSERT INTO dynamic_rules_version (version, updated_at, note)
VALUES (1, now(), 'initial')
ON CONFLICT (version) DO NOTHING;

-- Logg över interna sandlådekörningar
CREATE TABLE rule_evaluations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         text REFERENCES dynamic_rules(id),
  evaluated_at    timestamptz NOT NULL DEFAULT now(),
  passed          boolean NOT NULL,
  corpus_size     int NOT NULL,
  regressions     int NOT NULL,
  broken_fixtures jsonb,      -- Lista med fixture-id:n om provet fallerade
  f1_delta        float
);

-- Indexering för millisekundsnabb uppstart
CREATE INDEX idx_dynamic_rules_active ON dynamic_rules(status) WHERE status = 'active';
```

---

## 6. Rekommenderad byggordning (Fas 1 – Fas 3)

```
┌────────────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐
│         FAS 1          │      │         FAS 2          │      │         FAS 3          │
│  Enhetlig regeltabell  │ ───▶ │   In-Process Sandlåda  │ ───▶ │  Hypoteser & Autonomi  │
│  & In-Memory Snapshot  │      │   mot eval_corpus      │      │  (Sluten loop utan CI) │
└────────────────────────┘      └────────────────────────┘      └────────────────────────┘
```

### Fas 1: Grunden — Enhetlig regeltabell & In-Memory Snapshot
*Mål: Göra motorn kapabel att ta emot dynamiska regler utan omstart.*
1. Skapa migrationen `010_dynamic_rules.sql` och migrera eventuella rader från `lexicon_overrides`.
2. Bygg `rule-registry.server.ts` med funktionerna `getOrRefreshRuleSnapshot()`, multi-process cache-TTL och kompilering av Trie/Map.
3. Säkerställ katalogsynkronisering: När en drönare slås samman eller raderas i `/catalog`, uppdateras eller avaktiveras kopplade aliasregler i `dynamic_rules`.
4. Uppdatera [`HeuristicExtractor`](file:///C:/dev/drone-intel-hub/src/shared/infra/heuristic-ai.ts) och dess extraktorer så att de tar emot och applicerar snapshoten synkront.
5. Uppdatera gränssnittet på `/evaluation` så att godkännande av manuella mönster sparar i `dynamic_rules` och omedelbart slår igenom i extraktionen.

### Fas 2: Säkerhetsspärren — In-Process Sandlåda
*Mål: Bygga den inbyggda testaren som garanterar noll regressioner.*
1. Implementera `sandbox-evaluator.server.ts` med funktionerna `evaluateCandidateInSandbox(rule, mode)`.
2. Implementera partitionerad testning för snabba interaktiva tester i UI (< 1 s) och full testning för nattliga körningar.
3. Skriv enhetstester för sandlådan som verifierar att en avsiktligt trasig regel spärras med `passed = false`.
4. Lägg till en knapp i gränssnittet: *"Testa regel i sandlåda"* så att även manuella regler testas innan aktivering.

### Fas 3: Full autonomi — Hypotesgenerator, Schemalagd drift & Backporting
*Mål: Sluta loopen helt.*
1. Bygg `hypothesis.server.ts` med skyddat urval (endast korroborerat, analytikerbedömt eller strukturella fel; filtrera bort parserdefekter).
2. Skapa Nitro-tasken [tasks/evaluation/auto-improve.ts](file:///C:/dev/drone-intel-hub/tasks/evaluation/auto-improve.ts) (körs kl 04:15):
   - Hämtar verifierade avvikelser.
   - Genererar max 2 kandidatregler via LLM.
   - Kör dem genom sandlådan.
   - Aktiverar godkända regler och höjer `rules_version`.
3. Koppla hälsokontrollens ([tasks/evaluation/health.ts](file:///C:/dev/drone-intel-hub/tasks/evaluation/health.ts)) larm till automatisk karantän (`quarantined`) av det senaste dygnet regler vid produktionsdegradering.
4. Lägg till en audit-flik i gränssnittet på `/evaluation` som visar alla autonomt aktiverade regler med fullständig historik.
5. Skapa underhållsskriptet `scripts/rules-backport.mjs` för att periodiskt kunna exportera stabila regler ($\ge 30$ dagar aktiva) till statiska TypeScript-lexikon i källkoden.

---

## 7. Sammanfattning av säkerhetsgarantier

1. **Den incheckade Git-korpusen (`eval-corpus.json`):** Systemets grundlag. Automatiken får aldrig skriva över eller ta bort dessa fixtures.
2. **Noll regressioner ($\text{regressions} == 0$):** Inga undantag i sandlådan.
3. **Anti-förgiftning:** Inga hypoteser baserade på ensamma, oadjudikerade AI-avvikelser.
4. **Volymtak:** Max 2 regler per dygn för att förhindra hastig drift.
5. **Circuit Breaker:** Automatisk rollback vid F1-tapp i rullande produktionsevaluering.
6. **Multi-Process synk:** Konsekvent regeluppsättning i alla noder via monotona versioner och cache-TTL.
7. **Graceful Fallback:** Vid databasavbrott hålls alltid föregående in-memory snapshot eller statiska baslexikon aktiva. Extraktionen avbryts aldrig.
8. **Katalogsäkerhet:** Inga frikopplade "dangling pointer"-alias till raderade eller sammanslagna drönare.
