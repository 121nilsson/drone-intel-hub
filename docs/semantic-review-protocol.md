# Semantic review sheet (protocol v1)

Open the blind CSV exported by `scripts/semantic-review.ts export --step blind --limit 5`. Each row is
one occurrence of one attribute. Fill only `verdict`, `canonical_id` and `note` in step 1. Leave the
resolver/reveal columns alone until you run `export --step reveal`; the reveal sheet copies your
blind answers across and adds blank `final_verdict` and `final_note` columns (blank `final_verdict`
means "keep my blind verdict").

## Finding a valid `canonical_id` — never guess

Canonical ids are **not** invented by the reviewer. Print the reference for the exact frozen snapshot
used by this frame, grouped by semantic family:

```
npx tsx scripts/export-canonical-concepts.ts --report
# scripts/output/semantic-concepts.md   (grouped by family, with label, description, aliases)
# scripts/output/semantic-concepts.csv  (same list, filterable in a spreadsheet)
```

The reference header shows the snapshot id and hash; those must match the frame you are reviewing.
Only ids in that list are accepted. The list is the snapshot's full canonical manifest, including
concepts that have no alias rule (`cost.unit` and `guidance.system` are valid here): the frozen
resolver accepts any manifest id by exact identity, even when no rule mentions it. An id that is
_not_ in the reference is fabricated and is rejected. Treat an invalid-id message as a lookup
problem, not as proof your reading is wrong.

## Allowed `verdict` values

| Verdict                 | Use when                                                                         | `canonical_id`                                  |
| ----------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| `resolve`               | The excerpt supports exactly one concept in the frozen snapshot                  | **Required**, an exact id from the reference    |
| `withhold_context`      | The term resolves only under a guard the evidence does not satisfy               | Leave blank                                     |
| `withhold_ambiguous`    | A known polysemous term (`radius`, `power`, `capacity`) with no deciding context | Leave blank; explain the candidates in `note`   |
| `registry_gap`          | The concept is meaningful but has no id in the frozen registry                   | Leave blank; **describe the concept in `note`** |
| `unknown_term`          | The attribute is not a recognised concept                                        | Leave blank                                     |
| `insufficient_evidence` | The excerpt cannot support any call                                              | Leave blank                                     |

`registry_gap` is a registry-coverage finding, not a semantic verdict: it is never a successful
resolution, never converted into a canonical id, and never added to the registry automatically.
Use it instead of `unknown_term` when the term is real and interpretable but simply missing from the
snapshot. Describe the missing concept in `note` when the gap is your blind verdict; if you first
recognise the gap only after reveal, set `final_verdict=registry_gap` and describe it in `final_note`
(the blind `note` describes the blind judgement and cannot be reused). You are never forced to choose
a canonical id. `insufficient_evidence` is a real answer: it is reported as coverage loss and never
treated as approval.

## Examples

- `excerpt: "Maximum speed 120 km/h"` → `verdict=resolve`, `canonical_id=speed.max`.
- `excerpt: "radius of the target zone"` with no system class → `verdict=withhold_ambiguous`,
  `note="could be range.radius or a geometric radius"`.
- `excerpt: "power reading was nominal"` → `verdict=withhold_context`,
  `note="no RF/engine distinction"`.
- `excerpt: "the system uses a flux capacitor"` → `verdict=unknown_term`.
- `excerpt: "... current target engagement phase ..."` and no matching id in the reference →
  `verdict=registry_gap`, `note="discrete engagement-phase datum; absent from this snapshot"`.
- `excerpt: "see attached figure for details"` → `verdict=insufficient_evidence`.

## What the reviewer must not see in step 1

The blind sheet has no resolver result, no AI suggestion and no prior analyst verdict. If any of those
appear in the blind CSV, stop and fix the export before reviewing. After reveal, a revised
`final_verdict` plus a one-line `revision_reason` is recorded as a diagnostic only — it never
replaces your blind verdict as the evaluation label.

Source id, URL and publication date are shown for provenance. You should not need to open the source
document; if the excerpt alone cannot support a call, use `insufficient_evidence`.
