# Spec & Guide: Helt autonom självförbättrande loop utan extern CI

**Status:** Fas 1 och Fas 2 implementerade (regelmotor med cue/kontextfilter, sandlåda, deterministisk hypotesgenerator, nattlig `evaluation:rules`). Fas 3 (shadow, trust score, auto-aktivering, circuit breaker) återstår. `add_unit_scale` tillämpas ännu inte.  
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
| **Förbättringsförslag**| Manuellt kodarbete | Mönstergrävning i UI (Godkänn/Avvisa) | **AI-hypotesgenerator** med strikt DSL & skydd |
| **Regelpersistens** | Hårdkodad i `.ts`-filer | Delad tabell (`lexicon_overrides`) | **Enhetlig tabell (`dynamic_rules`) för manuellt & autonomt** |
| **Driftsättning** | Git commit + PR + CI | Manuell omstart / ej kopplad | **Atomär In-Memory Hot Reload med versionssynk** |
| **Externt beroende** | Node/Vitest lokalt | Git + GitHub Actions CI | **Noll externa beroenden** (100 % inuti Docker/Postgres) |
| **Autonomins mognad** | Ingen autonomi | Manuellt godkännande | **Skuggläge (Shadow Mode) & Gradvis Trust Calibration** |

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
│   │  via rules_version.    │   (Passerat prov  │    `eval_corpus` i Postgres.      │   │
│   │  Graceful fallback.    │    och skuggläge) │    Spärrar regressioner.          │   │
│   └────────────────────────┘                   └───────────────────────────────────┘   │
│                │                                                 │                     │
│                ▼                                                 ▼ [ Failed ]          │
│   [ Förbättrad Heuristik ]                             [ Quarantined / Rejected ]      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Pelare 1: Data-driven regelmotor & Multi-process synkronisering (Hot Reload)

Heuristikmotorn (`HeuristicExtractor`) måste förbli **synkron, ren och deterministisk**. Den får **aldrig** göra asynkrona databasanrop inuti `extract()`.

#### Bevarande av `IntelExtractor`-kontraktet
I [src/shared/contracts/ai.ts](file:///C:/dev/drone-intel-hub/src/shared/contracts/ai.ts) definieras:
```ts
export interface IntelExtractor {
  extract(raw: string, catalog: Drone[], context?: Extraction): Promise<Extraction>;
}
```
För att **inte** bryta kontraktet eller tvinga fram ändringar i befintliga anropare (`pipeline.ts`, `intake-page.tsx`, `evaluation.ts` och tiotals tester) implementeras regel-injektionen via:
1. **Konstruktor-injektion:** `new HeuristicExtractor(tier, snapshot?)`. I sandlådetester och isolerade körningar skickas test-snapshoten direkt i konstruktorn.
2. **Valfri options-parameter:**
   ```ts
   extract(raw: string, catalog: Drone[], context?: Extraction, options?: { rules?: RuleSnapshot }): Promise<Extraction>
   ```
3. **Automatisk fallback på servern:** Om ingen snapshot anges varken i konstruktorn eller i anropet hämtas aktiv snapshot automatiskt via `getOrRefreshRuleSnapshot()` på servern, eller standardlexikonen i webbläsaren. Inga befintliga call sites går sönder.

#### Bombsäker Graceful Fallback (Får aldrig kasta undantag):
Om PostgreSQL tappar anslutningen (pool exhaustion, container-omstart) får `getOrRefreshRuleSnapshot()` **under inga omständigheter kasta ett fel**, eftersom det skulle stoppa hela scraping- och ingestion-pipelinen:
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
      if (!dbConfigured()) return currentSnapshot;
      const [{ version }] = await db()`select coalesce(max(version), 0) as version from dynamic_rules_version`;
      if (version > currentVersion) {
        const rules = await db()`select * from dynamic_rules where status = 'active'`;
        currentSnapshot = compileRuleSnapshot(rules);
        currentVersion = version;
      }
    } catch (err) {
      // Graceful fallback: Kasta aldrig, logga varning och behåll minnescachen
      console.warn("[rule-registry] Failed to refresh snapshot from DB, keeping memory cache:", err);
    }
  }
  return currentSnapshot;
}
```

---

### Pelare 2: Domänspecifik regel-DSL med grammatisk flexibilitet

Automatiken får **aldrig** generera fri JavaScript-kod eller godtyckliga regexar. En fri LLM-genererad regex kan orsaka Catastrophic Backtracking (ReDoS) eller förstöra extraktionen med oavsiktliga sidoeffekter.

#### DSL-justeringar för flerspråkighet, fri ordföljd och böjningsformer:
1. **Obligatorisk språktagg:** Både cues, filter och stoppord måste ange språk (`"sv" | "en" | "ru" | "uk" | "all"`). Ett stoppord på engelska får aldrig dämpa ett likalydande ord på ukrainska/ryska.
2. **Token-avstånd i stället för strikt föregående ord:** I slaviska språk (ryska/ukrainska) är ordföljden friare än i engelska. Därför definieras kontextfilter med ett **avståndsfönster inom samma mening** (`maxTokenDistance: number`).
3. **Böjningsformer och ordstammar (Stemming):** 
   Slaviska språk har rika kasus- och genusböjningar (t.ex. *"дальність"*, *"дальності"*, *"дальністю"*).
   Regler kan därför antingen ange en ordstam (`stem?: string`), eller en array med kända böjningsformer (`terms: string[]`), så att motorns Trie matchar samtliga varianter utan att kräva dussintals separata regler.
4. **Katalogsäkerhet & Dangling Pointers:**
   Regler av typen `add_alias` mappar alias till `targetDroneId`. Vid sammanslagning eller borttagning av drönare ([`mergeDrones()`](file:///C:/dev/drone-intel-hub/src/shared/infra/drones.ts) / [`removeDrone()`](file:///C:/dev/drone-intel-hub/src/shared/infra/drones.ts)) uppdateras kopplade alias till det nya målet eller markeras som `superseded`. Vid kompilering av snapshot valideras att `targetDroneId` existerar i drönarkatalogen.

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

Detta är systemets absoluta säkerhetsventil. Ingen regel tillåts någonsin godkännas utan att först genomgå ett automatiserat prov mot det historiska korpuslagret (`eval_corpus`).

#### Partitionerad testning (Skalning för stor korpus):
När `eval_corpus` växer mot 2 000+ fixtures blir en fullständig provkörning av alla artiklar för resurskrävande för interaktiva anrop. Sandlådan använder därför en **tvåstegsmodell**:
1. **Snabb sandlåda (för interaktivt UI / snabbvalidering, < 1 sekund):**
   - **100 % täckning av berörd domän:** Alla fixtures i `eval_corpus` som innehåller den aktuella `semanticKey` (t.ex. alla fixtures med `altitude`).
   - **Kontrollstickprov:** Ett deterministiskt stratifierat stickprov på 100 orelaterade fixtures för att upptäcka oväntade sidokollisioner.
2. **Full sandlåda (nattlig schemalagd körning):**
   - Kör **samtliga** godkända fixtures i `eval_corpus` (100 % täckning).

#### Hårda godkännandevillkor (Invarianter):
- **Noll regressioner ($\text{regressions} == 0$):** Inte en enda godkänd fixture i `eval_corpus` som tidigare fungerade får ge fel svar eller missas.
- **Positiv effekt ($\Delta \text{F1} > 0$):** Regeln måste faktiskt öka precision/recall eller eliminera den observerade avvikelsen.
- **Ingen global degradering:** Total F1 över testkorpuset får inte minska med ens $0.001$.

---

### Pelare 4: AI-hypotesgenerator, Skuggläge & Gradvis autonomi

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
Om en avvikelse beror på numerisk formatering (`matchType === 'differentReading'`), felaktiga decimaler eller intervalltolkningar, ska **ingen dynamisk regel skapas**. Fallet klassificeras i stället automatiskt som `parser_defect` och skickas till en kö för mänsklig buggfix i källkoden.

---

### 3.5 Gradvis övergång till autonomi: Insyn, Skuggläge & Trust Score

För att analytikern inte ska tvingas lita blint på en "svart låda" bygger systemet på en **verifierbar trappa mot full autonomi**:

```
┌────────────────────────────────┐     ┌────────────────────────────────┐     ┌────────────────────────────────┐
│   STEG 1: Impact Preview       │     │    STEG 2: Shadow Mode         │     │   STEG 3: Trust Calibration    │
│   Diff-vy före beslut          │ ──▶ │    Testkörs dolt mot skarpt    │ ──▶ │   Automatisk befordran vid     │
│   (Före vs Efter i UI)         │     │    flöde under 48h-7 dagar     │     │   bevisad träffsäkerhet (≥95%) │
└────────────────────────────────┘     └────────────────────────────────┘     └────────────────────────────────┘
```

#### A. Impact Preview (Visuell diff i gränssnittet):
När AI:n formulerar en regelhypotes visas den i `/evaluation` med en **före/efter-jämförelse**:
- **Triggande artikel:** Källtext med den relevanta meningen markerad.
- **Hypotes & Rationale:** *"Tolkade 'дальність польоту' som range.max baserat på ukrainskt flygsammanhang."*
- **Före vs Efter:**
  - *Före:* `range.max = null`
  * *Efter:* `range.max = 850 km`
- **Sandlåderapport:** *"Testat mot 1 450 historiska fixtures: 0 regressioner, 1 fel rättat, $\Delta\text{F1} = +0.02$."*

#### B. Skuggläge (Shadow Mode / Ghost Run):
En regel som godkänts av sandlådan kan sättas i `status = 'shadow'` innan den påverkar produktionen:
- Den körs i bakgrunden vid varje ny dispatch parallellt med ordinarie extraktion.
- Den sparar inga data till drönarkatalogen, men loggar sina beslut:
  `shadow_metrics = { evaluated: 450, hits: 8, concordantWithAnalyst: 8, conflicts: 0 }`.
- Analytikern ser i gränssnittet: *"Regeln har körts dolt i 48 timmar mot 450 nya artiklar och haft 100 % träffsäkerhet."*

#### C. Trust Calibration & Villkorad Auto-Aktivering:
Systemet mäter kontinuerligt hur ofta analytikern godkänner AI-hypoteser i varje regelkategori (`trust_score`). När förtroendet är statistiskt bevisat kan automatisk aktivering låsas upp:
- **Villkor för autonom befordran (`shadow` → `active` utan manuellt klick):**
  1. Sandlådan gav **0 regressioner**.
  2. AI-modellens egen konfidensgrad för regeln är **$\ge 0.95$**.
  3. Systemets historiska *Trust Score* för just denna regelkategori (t.ex. `add_cue` för räckvidd) är **$\ge 95\%$** över minst 20 tidigare analytikerbeslut.
  4. Regeln har körts i **Skuggläge i minst 48 timmar** utan att generera motstridiga extraktioner.

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
       ┌────────────────────┐   ┌────────────────┐
       │  candidate_passed  │   │    rejected    │
       │ (väntar på beslut) │   │  (arkiverad)   │
       └────────────┬───────┘   └────────────────┘
                    │
            Valfri övergång till
                 Skuggläge
                    │
                    ▼
       ┌────────────────────┐
       │       shadow       │
       │ (dolt mot trafik)  │
       └────────────┬───────┘
                    │
      ┌─────────────┴─────────────┐
      │                           │
  Analytiker              Trust Score ≥ 95%
  klickar "Aktivera"      efter 48h i skuggläge
      │                           │
      └─────────────┬─────────────┘
                    │
                    ▼
       ┌────────────────┐
       │     active     │
       │ (i RAM-cache)  │
       └───────┬────────┘
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

### Circuit Breaker mot rullande produktionsevaluering
Om total F1 mot **nya inkommande artiklar i produktion** ([tasks/evaluation/health.ts](file:///C:/dev/drone-intel-hub/tasks/evaluation/health.ts), kl 03:45) sjunker med mer än **0.02** sedan föregående dygn:
- De regler som aktiverats under de senaste 24 timmarna sätts omedelbart i `status = 'quarantined'`.
- `dynamic_rules_version` räknas upp och systemet rullar tillbaka till den tidigare stabila minnescachen.
- Detta fångar överanpassning (*overfitting*) där en regel fungerade mot testkorpuset men skadade verkliga artiklar.

---

## 5. Datamodell och migrering i PostgreSQL

Vi ersätter `lexicon_overrides` med en sammanhållen tabellstruktur i migrationen `010_dynamic_rules.sql`. Skriptet innehåller en **idempotent dataportning** som lyfter befintliga rader från `lexicon_overrides`:

```sql
-- Enhetlig tabell för ALLA dynamiska regler (både manuella och genererade)
CREATE TABLE IF NOT EXISTS dynamic_rules (
  id             text PRIMARY KEY,
  version        int NOT NULL DEFAULT 1,
  kind           text NOT NULL CHECK (kind IN ('add_cue', 'context_filter', 'add_alias', 'add_stopword', 'add_unit_scale')),
  language       text NOT NULL DEFAULT 'all',
  payload        jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'candidate' 
                 CHECK (status IN ('candidate', 'evaluating', 'candidate_passed', 'shadow', 'active', 'rejected', 'quarantined', 'superseded')),
  origin         text NOT NULL CHECK (origin IN ('analyst', 'autonomous_sandbox', 'bootstrap')),
  target_key     text,          -- t.ex. 'range.max' eller drönar-ID för snabb indexering
  rationale      text,
  shadow_metrics jsonb,         -- { evaluated: int, hits: int, concordant: int, started_at: timestamptz }
  trust_score    float,         -- Historisk förtroendegrad vid befordran (0.0 - 1.0)
  created_at     timestamptz NOT NULL DEFAULT now(),
  promoted_at    timestamptz,
  decided_by     text NOT NULL  -- 'analyst' eller 'autonomous_sandbox'
);

-- Monoton versionsräknare för multi-process-synk (web/worker)
CREATE TABLE IF NOT EXISTS dynamic_rules_version (
  version      int PRIMARY KEY,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  note         text
);

INSERT INTO dynamic_rules_version (version, updated_at, note)
VALUES (1, now(), 'initial')
ON CONFLICT (version) DO NOTHING;

-- Logg över interna sandlådekörningar
CREATE TABLE IF NOT EXISTS rule_evaluations (
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
CREATE INDEX IF NOT EXISTS idx_dynamic_rules_active ON dynamic_rules(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_dynamic_rules_shadow ON dynamic_rules(status) WHERE status = 'shadow';

-- Idempotent dataportning från migration 009 (lexicon_overrides)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lexicon_overrides') THEN
    INSERT INTO dynamic_rules (id, kind, language, payload, status, origin, decided_by, created_at)
    SELECT 
      id,
      CASE 
        WHEN kind = 'cue' THEN 'add_cue'
        WHEN kind = 'alias' THEN 'add_alias'
        WHEN kind = 'stop' THEN 'add_stopword'
        WHEN kind = 'magnitude' THEN 'add_unit_scale'
        ELSE 'context_filter'
      END,
      'all',
      payload,
      status,
      'analyst',
      coalesce(decided_by, 'analyst'),
      created_at
    FROM lexicon_overrides
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
```

---

## 6. Implementationsplan: Fas 1 först

För att minimera leveransrisk och snabbt uppnå produktionsvärde delas arbetet upp strikt i tre etapper. Vi börjar med **Fas 1**:

```
┌─────────────────────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐
│             FAS 1               │      │         FAS 2          │      │         FAS 3          │
│  Enhetlig regeltabell, Snapshot │ ───▶ │   In-Process Sandlåda  │ ───▶ │  AI-Hypoteser, Shadow  │
│  & Manuell aktivering i UI      │      │   mot eval_corpus      │      │  Mode & Trust Score    │
└─────────────────────────────────┘      └────────────────────────┘      └────────────────────────┘
```

### Fas 1: Grunden — Enhetlig regeltabell, In-Memory Snapshot & Manuell aktivering
*Mål: Göra motorn kapabel att ta emot dynamiska regler synkront utan omstart och bevisa arkitekturen i drift.*
1. **Migration `010_dynamic_rules.sql`:**
   - Skapa tabellerna och porta över data från `lexicon_overrides`.
2. **`rule-registry.server.ts`:**
   - Implementera `getOrRefreshRuleSnapshot()` med TTL-cache och bombsäker felhantering (får aldrig kasta).
   - Skapa kompilatorn som bygger sök-Trie och normaliserade token-mönster.
3. **Uppdatera `HeuristicExtractor`:**
   - Lägg till konstruktor-injektion: `new HeuristicExtractor(tier, snapshot?)`.
   - Lägg till valfri options-parameter på `extract()`.
   - Låt motorn applicera aktiva dynamiska regler synkront vid sidan av statiska lexikon.
   - Säkerställ att inga befintliga call sites bryts.
4. **Koppla gränssnittet på `/evaluation`:**
   - Uppdatera förslags- och override-knapparna så att de skriver till `dynamic_rules`.
   - När en användare klickar "Godkänn" uppdateras regeln och slår omedelbart igenom i nästa körning utan omstart.
5. **Verifiera i drift:**
   - Kör befintliga enhetstester (`npm test`) för att bekräfta att allt förblir grönt.

### Fas 2: Säkerhetsspärren — In-Process Sandlåda
1. Implementera `sandbox-evaluator.server.ts` med partitionerad provkörning mot `eval_corpus`.
2. Lägg till knappen *"Testa regel i sandlåda"* i gränssnittet.

### Fas 3: Hypotesgenerator, Skuggläge & Trust Calibration
1. Implementera `hypothesis.server.ts` med anti-förgiftningsfilter.
2. Bygg **Impact Preview** (visuell diff före/efter) på `/evaluation`.
3. Implementera **Skuggläge (`shadow`)** i bakgrunden vid dispatches för att samla `shadow_metrics`.
4. Implementera **Trust Score-kalibrering** som låter systemet låsa upp villkorad automatisk aktivering när en regelkategori uppnått $\ge 95\%$ överensstämmelse.
5. Skapa underhållsskriptet `scripts/rules-backport.mjs` för att exportera långlivade regler tillbaka till källkoden.

---

## 7. Sammanfattning av säkerhetsgarantier

1. **Den incheckade Git-korpusen (`eval-corpus.json`):** Systemets grundlag. Automatiken får aldrig skriva över eller ta bort dessa fixtures.
2. **Noll regressioner ($\text{regressions} == 0$):** Inga undantag i sandlådan.
3. **Insyn & Impact Preview:** Analytikern ser alltid exakt före/efter-effekt och resonemang.
4. **Skuggläge (Shadow Mode):** Regler provkörs dolt mot skarpt flöde utan risk för produktionen.
5. **Trust Calibration:** Automatisk befordran aktiveras endast när bevisad precision överstiger 95 %.
6. **Anti-förgiftning:** Inga hypoteser baserade på ensamma, oadjudikerade AI-avvikelser eller parserdefekter.
7. **Volymtak:** Max 2 regler per dygn för att förhindra hastig drift.
8. **Circuit Breaker:** Automatisk rollback vid F1-tapp i rullande produktionsevaluering.
9. **Multi-Process synk:** Konsekvent regeluppsättning i alla noder via monotona versioner och cache-TTL.
10. **Graceful Fallback:** Vid databasavbrott hålls alltid föregående in-memory snapshot eller statiska baslexikon aktiva. Extraktionen avbryts aldrig.
11. **Katalogsäkerhet:** Inga frikopplade "dangling pointer"-alias till raderade eller sammanslagna drönare.
