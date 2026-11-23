# Semantic resolver replay (Phase 3.2 / S0)

> **A green S0 report does not show that the resolver is semantically correct.** It compares the resolver with the legacy normaliser on hand-written fixtures (agreement, not correctness) and checks technical invariants that need no human label. Whether a raw term really means a concept needs human-reviewed evidence, which S0 does not collect.

- Snapshot: `snap-code-seed-v1`, hash `10fe3ec6823a7537a4986a5bfe41c372d8c3fde3afc6a717815cb52f17a27e07`
- Resolver version 1.2.0, manifest 1.0.0, unit normalizer 1.1.0
- Seed-only snapshot: yes

## 1. Parity with the legacy normaliser (not correctness)

13 hand-written fixtures. The legacy answer is not ground truth, and a legacy pass-through is not a label.

| Class              | Count |
| ------------------ | ----- |
| agree              | 5     |
| agree_unrecognised | 1     |
| resolver_withholds | 7     |
| resolver_differs   | 0     |

| Key               | Label        | Legacy                   | Resolver                 | Class              | Detail                                                |
| ----------------- | ------------ | ------------------------ | ------------------------ | ------------------ | ----------------------------------------------------- |
| max_range         |              | range.max                | range.max                | agree              | both resolve range.max                                |
| range             | Max Range    | range.max                | unresolved_unknown       | resolver_withholds | legacy range.max, resolver unresolved_unknown         |
| operational_range |              | range.operational        | unresolved_unknown       | resolver_withholds | legacy range.operational, resolver unresolved_unknown |
| combat_radius     |              | range.combat_radius      | range.combat_radius      | agree              | both resolve range.combat_radius                      |
| fiber_spool       |              | range.fiber_spool        | unresolved_unknown       | resolver_withholds | legacy range.fiber_spool, resolver unresolved_unknown |
| speed             | Cruise speed | speed.cruise             | unresolved_unknown       | resolver_withholds | legacy speed.cruise, resolver unresolved_unknown      |
| dive_speed        |              | speed.dive               | unresolved_unknown       | resolver_withholds | legacy speed.dive, resolver unresolved_unknown        |
| service_ceiling   |              | altitude.service_ceiling | altitude.service_ceiling | agree              | both resolve altitude.service_ceiling                 |
| payload           | Warhead      | payload.warhead          | unresolved_unknown       | resolver_withholds | legacy payload.warhead, resolver unresolved_unknown   |
| unit_cost         |              | cost.unit                | cost.unit                | agree              | both resolve cost.unit                                |
| wingspan          |              | dimension.wingspan       | dimension.wingspan       | agree              | both resolve dimension.wingspan                       |
| beam              | Beam         | dimension.width          | unresolved_context       | resolver_withholds | legacy dimension.width, resolver unresolved_context   |
| some_unknown_key  |              | some_unknown_key         | unresolved_unknown       | agree_unrecognised | neither resolves (unresolved_unknown)                 |

No `resolver_differs` rows. `resolver_withholds` rows are coverage gaps or deliberate withholding, not errors.

## 2. Technical invariants

Result: **ALL PASS** (13/13 invariants).

| Id     | Invariant                                                                                                                   | Cases | Result |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| INV-01 | Every Class 1/3 rule resolves its own key to its own concept                                                                | 32    | pass   |
| INV-02 | A known-ambiguous (Class 4) term never resolves, in any context                                                             | 1680  | pass   |
| INV-03 | A Class 2 rule withholds without its context, resolves with all guards met, and withholds when any single guard is violated | 6     | pass   |
| INV-04 | An unknown term never gets a canonical id and is never echoed back as one                                                   | 22    | pass   |
| INV-05 | canonicalId is present if and only if status is 'resolved', and is always a manifest concept                                | 76    | pass   |
| INV-06 | Distinct concepts do not collapse                                                                                           | 480   | pass   |
| INV-07 | Spellings in the defined equivalence classes resolve identically (not a universal claim)                                    | 17    | pass   |
| INV-08 | Delimiters and unit suffixes that carry meaning keep keys distinct                                                          | 4     | pass   |
| INV-09 | Resolution is deterministic: 200 repeats give byte-identical results                                                        | 15    | pass   |
| INV-10 | Results are deeply frozen and share no mutable state                                                                        | 5     | pass   |
| INV-11 | The content hash and the answers do not depend on rule input order                                                          | 38    | pass   |
| INV-12 | Unit classification needs a full match: acceleration is never speed, prefixes never decide a dimension                      | 10    | pass   |
| INV-13 | Near-miss canonical identifiers are not accepted by Gate 0                                                                  | 14    | pass   |

## 3. Semantic correctness

**Not measured by S0.** No claim is made about whether any mapping is right. This needs the human-reviewed evidence planned in Phase 3.2 S1–S5.
