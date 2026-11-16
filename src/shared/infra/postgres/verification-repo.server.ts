import type {
  ControlRecord,
  ControlVerdictRow,
  PostTextRow,
  VerificationPostRow,
  VerificationRepo,
} from "@/shared/contracts/verification-repo";
import { db } from "@/shared/infra/postgres/db.server";

/** PostgreSQL adapter for VerificationRepo. */
export function createPostgresVerificationRepo(): VerificationRepo {
  return {
    async postsForVerification(ids, urls) {
      return await db()<VerificationPostRow[]>`
    select id, data->>'sourceName' as "sourceName", data->>'url' as url, data->>'text' as text,
           content_hash as "contentHash"
      from dispatches
     where (coalesce(data->>'text', '') <> ''
            and (id = any(${[...ids]}) or data->>'url' = any(${[...urls]})))
        or (content_hash is not null and id = any(${[...ids]}))`;
    },

    async postTexts(ids) {
      return await db()<PostTextRow[]>`
            select id, data->>'text' as text, created_at from dispatches where id = any(${[...ids]})`;
    },

    async askedClaimIds(entailmentVersion) {
      const rows = await db()<{ claim_id: string }[]>`select claim_id from verifier_controls
        where entailment_version = ${entailmentVersion}`;
      return rows.map((r) => r.claim_id);
    },

    async recordControl(c: ControlRecord) {
      await db()`insert into verifier_controls (claim_id, drone_id, spec_key, family, language,
            source_id, true_value, altered_value, verdict, span, provider, model, entailment_version)
          values (${c.claimId}, ${c.droneId}, ${c.specKey}, ${c.family},
            ${c.language}, ${c.sourceId}, ${c.trueValue},
            ${c.alteredValue}, ${c.verdict}, ${c.span}, ${c.provider},
            ${c.model}, ${c.entailmentVersion})
          on conflict (claim_id, entailment_version) do nothing`;
    },

    async controlVerdicts(entailmentVersion) {
      return await db()<ControlVerdictRow[]>`
        select verdict, family, language from verifier_controls
         where entailment_version = ${entailmentVersion}`;
    },

    async usedToday(purposes) {
      const [row] = await db()<{ input: string | null; output: string | null }[]>`
    select sum(input) as input, sum(output) as output from ai_token_usage
     where day = current_date and purpose = any(${[...purposes]})`;
      return { input: Number(row?.input ?? 0), output: Number(row?.output ?? 0) };
    },

    async recordUsage(purpose, used) {
      await db()`insert into ai_token_usage (day, purpose, input, output, calls)
    values (current_date, ${purpose}, ${used.input}, ${used.output}, 1)
    on conflict (day, purpose) do update
      set input = ai_token_usage.input + excluded.input,
          output = ai_token_usage.output + excluded.output,
          calls = ai_token_usage.calls + 1`;
    },
  };
}
