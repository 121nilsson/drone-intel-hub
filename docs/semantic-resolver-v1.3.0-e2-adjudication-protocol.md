# E2 blind language adjudication protocol

**Protocol version: `e2-lang-1`.** The version is stored on every adjudication and in the adjudication manifest. Part of [semantic-resolver-v1.3.0-e2-sampling-design.md](./semantic-resolver-v1.3.0-e2-sampling-design.md) (revision B). Code: `src/entities/normalization/semantic-eval/e2/adjudication.ts` and `scripts/e2-adjudication.ts`.

## Purpose and order

The reviewer records the language of each drawn excerpt **before** the resolver runs. The result is `adjudicatedLanguage`. The resolver uses it only when an example has no `declaredLanguage`. It is never written into `declaredLanguage`.

1. Freeze the population (`scripts/e2-freeze-and-draw.ts`).
2. Draw the sample (same script).
3. Blind adjudication (this protocol).
4. Freeze the adjudications: `adjudications.jsonl` and `adjudication-manifest.json`, hash-chained to the sample manifest.
5. Only then the resolver run.

## What the reviewer sees, and does not see

The blind CSV has three columns: `example_id`, `excerpt`, `language`. The reviewer sees an opaque id and the stored excerpt (at most 300 characters). The export holds **nothing else**: no routing stratum, no declared language, no detection, no resolver output or expected outcome, no source URL or id, no publication date, no raw key, label or value, no family, origin, stratum or weight. Rows are sorted by `example_id`, which is a hash, so the order says nothing about the stratum.

**The reviewer must not look up the source.** No search for the text, no opening of a link, no check against the application or the database. Judge the excerpt as it stands. If it cannot be judged, the answer is `unknown`.

## Values

Fill `language` with exactly one of these (lower case; anything else is refused at import):

| Value     | Use when                                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `en`      | The running text is English.                                                                                                            |
| `ru`      | The running text is Russian.                                                                                                            |
| `uk`      | The running text is Ukrainian.                                                                                                          |
| `mixed`   | The text genuinely mixes languages, for example a Russian sentence with an English clause. It is never forced into `ru` or `uk`.        |
| `unknown` | The language is ambiguous or cannot be judged: too short, only numbers or symbols, only names, or a Cyrillic text that is not decisive. |

Guidance:

- **Names and designations.** A drone or system name, a manufacturer or a place name does not set the language. `Shahed-136` or `Lancet` in an otherwise Ukrainian sentence is a Ukrainian sentence. A text that is only names is `unknown`.
- **Quotes.** Judge the language the excerpt is written in. A short quotation in another language inside a sentence does not make the text `mixed`; two substantial parts in different languages do.
- **Technical keys and units.** Tokens such as `max_speed`, `km/h`, `MTOW` and model numbers are technical vocabulary. Ignore them when judging, unless they are all there is (then `unknown`).
- **Cyrillic.** Russian and Ukrainian share letters. Use distinguishing words and letters (`ы`, `э`, `ъ` for Russian; `і`, `ї`, `є`, `ґ` for Ukrainian) and grammar. If you cannot tell, use `unknown`, not a guess.
- Do not infer the language from what you think the source is.

## Second reviewer (optional)

A second reviewer is optional. If used:

- The second reviewer gets **the same blind export**, independently, and must not see the first reviewer's file. Reviewer ids are pseudonymous and must differ.
- Both reviewers must adjudicate exactly the same set of example ids.
- Where the two values differ, the example is a **disagreement**. It is never settled by order, by the first reviewer, or by a majority rule applied by the tool.

## Disagreements

Every disagreement is resolved **explicitly** by a person (for example both reviewers, or a third person) who records the final value and their own pseudonymous id in a resolution file. The final value may be any allowed value, including `mixed` or `unknown`. The freeze is refused while any disagreement has no resolution, and refused for a resolution that names an example the reviewers agree on.

The adjudication record keeps both reviewers' values, `disagreement: true`, `resolvedBy` and the final value. The manifest's `disagreementCount` equals the number of disagreements.

## File formats

**Reviewer file.** The export, with `language` filled in. Header exactly `example_id,excerpt,language`. The `excerpt` column is ignored at import. One row per example id: a missing id, an unknown id or a duplicate id is refused.

**Resolution file**, CSV (`.csv`) with header `example_id,final_language,resolved_by,note` (`note` optional), or JSONL (`.jsonl`), one object per line:

```
{"exampleId":"<id>","finalAdjudicatedLanguage":"mixed","resolvedBy":"rev-3","note":"optional"}
```

## Commands

```
npx tsx scripts/e2-adjudication.ts export --sample-dir <dir> --out <file.csv>
npx tsx scripts/e2-adjudication.ts import --sample-dir <dir> --reviewer <csv> --reviewer-id <id> \
  [--second-reviewer <csv> --second-reviewer-id <id>] [--resolutions <csv|jsonl>] --out <dir>
```

`export` refuses an existing file. `import` requires `--out`, refuses a non-empty one, and never writes into the sample directory. Errors exit with code 2 and one message.

## Completeness and integrity

The import refuses a missing id, an unknown id, a duplicate id in a reviewer file, reviewer files with different id sets, a second reviewer id equal to the first, an invalid value, an unresolved disagreement and a resolution that is not for a disagreement. The sample holds one example per evidence cluster (step b collapses clusters before the draw), so adjudications cannot conflict inside a cluster; the import checks that no two drawn examples share an `evidenceClusterId`.

## What the frozen stage carries

`adjudication-manifest.json`: `sampleManifestSha256` (the hash of the sample manifest), `adjudicationSha256` (SHA-256 of `adjudications.jsonl`), the protocol version, the reviewer ids, `secondReviewerUsed`, `disagreementCount` and `frozenAt`. A frozen stage is never rewritten.

`mixed` and `unknown` give the resolver no language.
