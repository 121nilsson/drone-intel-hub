# Semantic review sheet (protocol v1)

Open the blind CSV exported by `scripts/semantic-review.ts export --step blind --limit 5`. Each row is
one occurrence of one attribute. Fill only `verdict`, `canonical_id` and `note` in step 1. Leave the
resolver/reveal columns alone until you run `export --step reveal`; the reveal sheet copies your
blind answers across and adds a blank `final_verdict` (blank means "keep my blind verdict").

## Allowed `verdict` values

| Verdict                 | Use when                                                                         | `canonical_id`                                 |
| ----------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| `resolve`               | The excerpt supports exactly one concept in the canonical manifest               | **Required**, and must be an exact manifest id |
| `withhold_context`      | The term resolves only under a guard the evidence does not satisfy               | Leave blank                                    |
| `withhold_ambiguous`    | A known polysemous term (`radius`, `power`, `capacity`) with no deciding context | Leave blank; explain the candidates in `note`  |
| `unknown_term`          | The attribute is not a recognised concept                                        | Leave blank                                    |
| `insufficient_evidence` | The excerpt cannot support any call                                              | Leave blank                                    |

You are never forced to choose a canonical id. `insufficient_evidence` is a real answer: it is reported
as coverage loss and never treated as approval.

## Examples

- `excerpt: "Maximum speed 120 km/h"` → `verdict=resolve`, `canonical_id=speed.max`.
- `excerpt: "radius of the target zone"` with no system class → `verdict=withhold_ambiguous`,
  `note="could be range.radius or a geometric radius"`.
- `excerpt: "power reading was nominal"` → `verdict=withhold_context`,
  `note="no RF/engine distinction"`.
- `excerpt: "the system uses a flux capacitor"` → `verdict=unknown_term`.
- `excerpt: "see attached figure for details"` → `verdict=insufficient_evidence`.

## What the reviewer must not see in step 1

The blind sheet has no resolver result, no AI suggestion and no prior analyst verdict. If any of those
appear in the blind CSV, stop and fix the export before reviewing. After reveal, a revised
`final_verdict` plus a one-line `revision_reason` is recorded as a diagnostic only — it never
replaces your blind verdict as the evaluation label.

Source id, URL and publication date are shown for provenance. You should not need to open the source
document; if the excerpt alone cannot support a call, use `insufficient_evidence`.
