# Semantic evaluation data (Phase 3.2)

Files here are generated evaluation data, never production data and never audit data.

- `frame-rows.jsonl` — a small **synthetic demo frame** (`origin: "fixture"`) so the sampler can be
  exercised offline. The real frame is exported separately from the read-only historical store and
  passed with `--in`; `verification_audit` is **never** read (D1).
- `examples.jsonl` — RAW frozen examples, written by `sample-historical-evaluation-set.ts --apply`.
- `predictions.jsonl` — resolver output over the whole frame, same script.
- `manifest.json` — seed, cutoff, N_h/n_h, exclusions and SHA-256 hashes.
- `suggestions.jsonl` — AI suggestions from `prepare-semantic-suggestions.ts`, status `suggested`.
- `decisions.jsonl` — human verdicts imported by `semantic-review.ts import`. **Not committed**: no
  human labels are fabricated. The maintainer creates this file by reviewing the CSV queue.

`exampleId` names one occurrence: the same attribute twice in one source gets two ids. Identical
evidence is collapsed before the frame is frozen; different attributes of one document are kept.

D1–D5 follow the recommendations in the plan: no audit reads, files not DB, ≤300-char excerpts
committable, deterministic keyword family classifier with an explicit `unknown` language stratum,
and the Phase 3 spec amended in the same change as the plan. D6 is resolved in rev. 3.
