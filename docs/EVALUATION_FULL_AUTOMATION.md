# Spec & Guide: Helt autonom självförbättrande loop utan extern CI

**Status:** Teknisk specifikation och implementationsguide (v3)  
**Fil:** `docs/EVALUATION_FULL_AUTOMATION.md`  
**Relaterade specifikationer:** `docs/EVALUATION_MODE.md` (v1, manuell utvärdering), `docs/EVALUATION_AUTOMATION.md` (v2, halvautonom loop med mänskligt godkännande)  
**Relaterad kod:** `src/features/evaluation/**`, `src/shared/infra/evaluation.*`, `src/shared/infra/heuristics/**`, `src/shared/lexicons/**`, `tasks/evaluation/**`

---

## 1. Vision och sammanfattning

Denna specifikation beskriver hur **Drone Intel Hub** kan uppnå **äkta runtime-autonomi**: en sluten, självförbättrande loop där systemet upptäcker sina egna heuristikfel, formulerar regelhypoteser, validerar dem i en intern sandlåda och driftsätter förbättringarna direkt i minnet — **helt utan att pusha git-commits, förlita sig på externa CI-pipelines (GitHub Actions) eller starta om applikationsservern**.

### 1.1 Evolutionen av utvärderingssystemet

| Egenskap | v1 (EVALUATION_MODE) | v2 (EVALUATION_AUTOMATION) | v3 (EVALUATION_FULL_AUTOMATION) |
| :--- | :--- | :--- | :--- |
| **Utvärdering** | Manuell via `/evaluation` | Nattlig cron (03:15 / 03:45) | Händelsedriven och schemalagd |
| **Regressionstest** | Manuellt körd Vitest | Hermetisk Vitest i git | **In-Process Sandbox** mot Postgres |
| **Förbättringsförslag**| Manuellt kodarbete | Mönstergrävning i UI (Godkänn/Avvisa) | **Autonom hypotesgenerering via AI** |
| **Driftsättning** | Git commit + PR + CI | `lexicon_overrides` sparad i DB | **Atomär In-Memory Hot Reload** |
| **Externt beroende** | Node/Vitest lokalt | Git + GitHub Actions CI | **Noll externa beroenden** (100 % inuti Docker/Postgres) |
| **Mänsklig roll** | Utvecklare kodar fix | Analytiker klickar godkänn | **Övervakare / Auditör** (undantagshantering) |

---

## 2. Varför extern CI och kodändringar är en flaskhals

I traditionell mjukvaruutveckling och i v1/v2 av detta system gäller principen:
> *"Autonomi i datalagret, granskning i kodlagret. Inga ändringar i `.ts`-filer utan en människa och en git-commit."*

Detta skapar tre allvarliga begränsningar i en domän som OSINT/drönarunderrättelser:
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
│   │  Kör heuristik isolerat│                   │    Identifierar mönster i         │   │
│   │  och loggar avvikelser │──[ Mismatches ]──▶│    mismatches; skapar kandidat-   │   │
│   │  i `eval_reports`.     │                   │    regler i strikt DSL.           │   │
│   └────────────────────────┘                   └───────────────────────────────────┘   │
│                ▲                                                 │                     │
│                │                                                 │ [ Candidate Rule ]  │
│                │                                                 ▼                     │
│   ┌────────────────────────┐                   ┌───────────────────────────────────┐   │
│   │  4. Hot Reload         │                   │    3. In-Process Test Sandbox     │   │
│   │  Aktiverar regeln i    │◀──[ Promoted ]────│    Kör regeln mot hela            │   │
│   │  minnescachen (Trie).  │   (ΔF1 > 0 &      │    `eval_corpus` i Postgres.      │   │
│   │  Noll omstart.         │    0 regressioner)│    Spärrar regressioner.          │   │
│   └────────────────────────┘                   └───────────────────────────────────┘   │
│                │                                                 │                     │
│                ▼                                                 ▼ [ Failed ]          │
│   [ Förbättrad Heuristik ]                             [ Quarantined / Rejected ]      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Pelare 1: Data-driven regelmotor med minnes-snapshot (Hot Reload)

Heuristikmotorn (`HeuristicExtractor`) måste förbli **synkron, ren och deterministisk**. Den får **aldrig** göra asynkrona databasanrop inuti `extract()`.

#### Hur minnescachen fungerar:
1. **Regel-snapshot vid start:** Servern läser alla aktiva regler (`status = 'active'`) från tabellen `dynamic_rules` i PostgreSQL till ett oföränderligt objekt i RAM (`RuleSnapshot`).
2. **Kompilerad regelrepresentation:** Reglerna kompileras till en intern lookup-struktur (Aho-Corasick / Trie för sökord och normaliserade regex-arrayer för kontext).
3. **Atomär uppdatering:** När en ny regel godkänns av sandlådan sparas den i databasen och en uppdaterad `RuleSnapshot` ersätter den aktiva referensen atomärt i minnet:
   ```ts
   // src/shared/infra/heuristics/rule-registry.server.ts
   let currentSnapshot: RuleSnapshot = emptySnapshot();

   export function getActiveRuleSnapshot(): RuleSnapshot {
     return currentSnapshot;
   }

   export async function reloadRuleSnapshot(): Promise<void> {
     const rules = await db()`select * from dynamic_rules where status = 'active'`;
     currentSnapshot = compileRuleSnapshot(rules);
   }
   ```
4. **Extraktorn tar snapshot som argument:** `extract(raw, catalog, snapshot = getActiveRuleSnapshot())`.

---

### Pelare 2: Domänspecifik regel-DSL (Skydd mot hallucinationer & ReDoS)

Automatiken får **aldrig** generera fri JavaScript-kod eller godtyckliga regexar. En fri LLM-genererad regex kan orsaka Catastrophic Backtracking (ReDoS) eller förstöra extraktionen med oavsiktliga sidoeffekter.

Alla förbättringar måste uttryckas i en **strikt typad DSL**:

```ts
export type DynamicRule = 
  | AddCueRule
  | AddContextFilterRule
  | AddAliasRule
  | AddStopwordRule
  | AddUnitScaleRule;

export interface AddCueRule {
  kind: "add_cue";
  id: string;
  semanticKey: string;           // t.ex. "range.max"
  language: "sv" | "en" | "ru" | "uk";
  term: string;                  // t.ex. "дальність польоту"
  confidence: number;            // 0.1 - 1.0
}

export interface AddContextFilterRule {
  kind: "context_filter";
  id: string;
  semanticKey: string;           // t.ex. "altitude.max"
  action: "suppress" | "reroute";
  targetKey?: string;            // t.ex. "altitude.target_max" vid korsklasskontamination
  matchPattern: "preceding_word" | "following_word";
  triggerWords: string[];        // t.ex. ["engagement", "target", "ціль", "перехоплення"]
}

export interface AddAliasRule {
  kind: "add_alias";
  id: string;
  targetDroneId: string;         // t.ex. "shahed-136"
  alias: string;                 // t.ex. "герань-2"
  sourceEpoch?: string;
}

export interface AddStopwordRule {
  kind: "add_stopword";
  id: string;
  term: string;                  // t.ex. "бпла", "kamikaze", "interceptor"
  scope: "system_name" | "manufacturer";
}

export interface AddUnitScaleRule {
  kind: "add_unit_scale";
  id: string;
  unit: string;                  // t.ex. "млрд"
  multiplier: number;            // 1_000_000_000
  dimension: "currency" | "distance" | "weight" | "speed";
}
```

---

### Pelare 3: In-Process Test Sandbox ("Inbyggd CI")

Detta är systemets säkerhetsventil. Ingen regel tillåts någonsin nå `status = 'active'` utan att först genomgå ett automatiserat prov mot det historiska corpus-lagret.

#### Testkörningsprocessen:
1. En hypotetisk `RuleSnapshot_Test` skapas: `currentSnapshot + candidateRule`.
2. Sandlådan kör `evaluateHeuristic()` mot samtliga godkända fixtures i tabellen `eval_corpus` i Postgres:
   ```ts
   // Körs som ren TypeScript i serverprocessen (eller via Nitro task worker)
   const baselineScore = await getCorpusBaseline();
   const testResult = await evaluateSnapshotAgainstCorpus(RuleSnapshot_Test);
   ```
3. **Hårda godkännandevillkor (Invarianter):**
   - **Noll regressioner ($\text{regressions} == 0$):** Inte ett enda godkänt fall i `eval_corpus` som tidigare gav rätt svar får ge fel svar eller missas.
   - **Positiv effekt ($\Delta \text{F1} > 0$):** Regeln måste faktiskt lösa den specifika avvikelse den skapades för eller höja metriken för berörd `semanticKey`.
   - **Ingen global degradering:** Total F1 över hela testkorpuset får inte minska med ens $0.001$.
4. **Utfall:**
   - **Godkänd:** `status = 'active'`, `decided_by = 'autonomous_sandbox'`, monotonic version höjs, in-memory cache uppdateras omedelbart.
   - **Underkänd:** `status = 'rejected'`, testrapport sparas i `rule_evaluations` med exakt information om vilken fixture som bröts.

---

### Pelare 4: AI-hypotesgenerator & Mönsteranalysator

Hypotesmotorn aktiveras automatiskt efter varje utvärderingskörning där avvikelser (`mismatches`) hittats.

#### Process:
1. **Klusteranalys:** Gruppera avvikelser per `specKey` och mismatch-typ (`falsePositive`, `miss`, `wrongKey`).
2. **Kandidaturval:** Välj de 5 mest frekventa felmönstren.
3. **AI-adjudicering och formulerande av hypotes:**
   En LLM anropas med en specialiserad prompt som kräver strikt JSON enligt regel-DSL:en.

```
SYSTEM PROMPT:
Du är en deterministisk OSINT-regeloptimerare för en drönardatabas. 
Ditt uppdrag är att formulera EXAKT EN regel i vår DSL för att åtgärda en observerad avvikelse, 
utan att skapa oönskade sidoeffekter.

GIVEN DATA:
Mismatch: {
  "specKey": "altitude",
  "heuristicValue": 40,
  "unit": "km",
  "evidence": "target engagement altitude of up to 40 km",
  "issue": "Korsklasskontamination: målets maxhöjd tolkades som drönarens egen flyghöjd"
}

TILLGÄNGLIGA REGLER:
- add_cue
- context_filter
- add_alias
- add_stopword

SVARA ENDAST MED GILTIG JSON ENLIGT REGEL-DSL:
{
  "kind": "context_filter",
  "semanticKey": "altitude.max",
  "action": "reroute",
  "targetKey": "altitude.target_max",
  "matchPattern": "preceding_word",
  "triggerWords": ["target engagement", "engagement", "target", "ціль"]
}
```

---

## 4. Livscykel och tillståndsmaskin för regler

```
             ┌─────────────────────────┐
             │       Hypothesis        │
             │  (genererad av AI/mön)  │
             └────────────┬────────────┘
                          │
                          ▼
             ┌─────────────────────────┐
             │    evaluating_sandbox   │
             │  (körs mot eval_corpus) │
             └──────┬────────────┬─────┘
    Passerar test   │            │  Misslyckas / Regresserar
    (ΔF1 > 0, 0 fel)│            │
                    ▼            ▼
       ┌────────────────┐   ┌────────────────┐
       │     active     │   │    rejected    │
       │ (i RAM-cache)  │   │  (arkiverad)   │
       └───────┬────────┘   └────────────────┘
               │
   Hälsolarm i produktion
   (drift / kvalitetstapp)
               │
               ▼
       ┌────────────────┐
       │   quarantined  │
       │ (avaktiverad)  │
       └────────────────┘
```

### Automatisk Rollback (Circuit Breaker)
Om den dagliga hälsokontrollen (`tasks/evaluation/health.ts` kl 03:45) upptäcker att produktionens totala F1 sjunker med mer än **0.02** sedan föregående dygn:
1. Hälsokontrollen identifierar vilka regler som aktiverades under de senaste 24 timmarna.
2. Reglerna sätts omedelbart till `status = 'quarantined'`.
3. In-memory snapshot laddas om till föregående säkra version.
4. Ett larm loggas i `eval_reports` med orsak och berörda regel-ID:n.

---

## 5. Datamodell i PostgreSQL

Följande tabeller skapas i en ny migration (`010_full_automation.sql`):

```sql
-- Alla dynamiska regler som motorn kan köra
CREATE TABLE dynamic_rules (
  id           text PRIMARY KEY,
  version      int NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('add_cue', 'context_filter', 'add_alias', 'add_stopword', 'add_unit_scale')),
  payload      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'candidate' 
               CHECK (status IN ('candidate', 'evaluating', 'active', 'rejected', 'quarantined', 'superseded')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  promoted_at  timestamptz,
  decided_by   text NOT NULL, -- 'autonomous_sandbox' eller 'analyst'
  rationale    text,
  target_key   text           -- t.ex. 'range.max' för snabb indexering
);

-- Resultat från intern sandlådetestning
CREATE TABLE rule_evaluations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id        text REFERENCES dynamic_rules(id),
  evaluated_at   timestamptz NOT NULL DEFAULT now(),
  passed         boolean NOT NULL,
  corpus_size    int NOT NULL,
  regressions    int NOT NULL,
  f1_before      float NOT NULL,
  f1_after       float NOT NULL,
  f1_delta       float NOT NULL,
  broken_fixtures jsonb -- Lista med fixture-id:n om testet fallerade
);

-- Index för snabb snapshot-inladdning vid start
CREATE INDEX idx_dynamic_rules_active ON dynamic_rules(status) WHERE status = 'active';
```

---

## 6. Implementationssteg för autonoma agenter

Om en utvecklare eller AI-kodningsagent ska bygga denna fulla automation, genomförs arbetet i följande 6 precisa steg:

### Steg 1: Skapa `rule-registry.server.ts`
Implementera hanteringen av in-memory regelsnapshot:
- Ladda aktiva regler från `dynamic_rules`.
- Kompilera söktermer till ett Trie- eller Map-baserat register.
- Exponera `getActiveRuleSnapshot()` för serverfunktioner och extraktorn.

### Steg 2: Injicera snapshot i `HeuristicExtractor`
I `src/shared/infra/heuristic-ai.ts` och dess underliggande extraktorer (`facts.ts`, `names.ts`, `observations.ts`):
- Uppdatera extraktorernas funktionssignaturer: ta emot en valfri `RuleSnapshot`.
- Om snapshot skickas med: applicera dynamiska cues, alias och filter *utöver* grundlexikonen.
- Om ingen snapshot anges: använd de inbyggda TS-standardlexikonen (garanterar 100 % bakåtkompatibilitet med befintliga enhetstester).

### Steg 3: Bygg Sandlåde-testaren (`sandbox-evaluator.server.ts`)
Implementera funktionen:
```ts
export async function evaluateCandidateRuleInSandbox(
  rule: DynamicRule
): Promise<{ passed: boolean; delta: number; regressions: number; brokenIds: string[] }>
```
- Läs in samtliga `approved` fixtures från `eval_corpus`.
- Skapa en test-snapshot med den nya regeln injicerad.
- Kör alla fixtures genom `checkFixture()`.
- Kontrollera att `regressions === 0` och att F1 för den berörda spec-nyckeln har ökat.

### Steg 4: Implementera Hypotesgeneratorn (`hypothesis.server.ts`)
Bygg bryggan mellan felrapporter och DSL:
- Läs senaste avvikelser från `eval_reports`.
- Skapa prompts för `chatCompletionOnce()` som genererar strikt typad DSL.
- Skriv kandidatregeln till `dynamic_rules` med `status = 'candidate'`.

### Steg 5: Skapa Nitro-tasken `tasks/evaluation/auto-improve.ts`
Schemalägg en återkommande task (t.ex. kl 04:15, efter eval och health check):
1. Kontrollera att `eval_lock` är ledigt.
2. Hämta olösta avvikelser.
3. Generera max 3 kandidatregler.
4. Kör varje kandidat genom sandlådan.
5. Om godkänd: sätt `status = 'active'`, logga framgång och anropa `reloadRuleSnapshot()`.

### Steg 6: Skapa Dashboard-vy för auditering
På `/evaluation`:
- Visa en lista över alla **Autonomt aktiverade regler** (`status = 'active'`).
- Visa historik över F1-ökning för varje regel.
- Ge analytikern en "Pausa / Återkalla"-knapp (som sätter regeln i `quarantined`) ifall en människa bedömer att en regel är olämplig.

---

## 7. Säkerhetsgarantier och skydd mot dataförgiftning

Att låta ett system ändra sitt eget beteende i drift medför risker för modellkollaps och överanpassning (*overfitting*). Följande 4 skyddsvärn är **obligatoriska inbyggda spärrar**:

1. **Den gyllene grundstammen i Git (`eval-corpus.json`):**
   - De 50–100 initiala positiva och negativa fixtures som finns incheckade i git är systemets "grundlag".
   - Sandlådan testar **alltid** mot dessa. En autonom regel kan aldrig tillåtas modifiera eller radera en incheckad git-fixture.
2. **Volymtak per tidsenhet:**
   - Max **2 autonoma regler per dygn** får befordras till aktiv drift. Detta förhindrar att en serie snabba beslut förvränger extraktionen.
3. **Deterministisk isolering:**
   - Inga LLM-vikter modifieras och ingen fri kod kompileras. Endast parametrar och filter i ett låst koordinatsystem (DSL) förändras.
4. **Full revisionshistorik (Audit Trail):**
   - Varje rad i `dynamic_rules` sparar `rationale`, källartikelns text, och id på den `rule_evaluation` som bevisade dess matematiska fördel.

---

## 8. Slutsats

Genom att kombinera en **strikt regel-DSL**, **atomär in-memory caching** och en **inbyggd sandlådetestare** uppnår Drone Intel Hub fördelarna med kontinuerlig förbättring utan riskerna för driftstörning och utan behov av externa CI/CD-pipelines. Systemet blir i praktiken självläkande och självlärande.
