import type { AuditAnswers } from "@/shared/contracts/audit-repo";
import { db } from "@/shared/infra/postgres/db.server";

/** Recording the person's answers, disputes and second looks. */
export function answerPart(): AuditAnswers {
  return {
    async recordAnswer(input) {
      const rows = await db()`update verification_audit
       set answer = ${input.answer}, obviously_wrong = ${input.obviouslyWrong},
           read_via = ${input.readVia}, answered_at = now()
     where id = ${input.id}
     returning id`;
      return rows.length > 0;
    },

    async recordDispute(input) {
      const rows = await db()`update verification_audit
       set control_disputed_at = ${input.disputedAt}
     where id = ${input.id} and role = 'control' and coalesce(control_kind, 'misread') = 'misread'
     returning id`;
      return rows.length > 0;
    },

    async recordSecondLook(input) {
      const rows = await db()`update verification_audit set second_look = ${input.look}
     where id = ${input.id} and role <> 'control' and answer in ('yes', 'no') returning id`;
      return rows.length > 0;
    },
  };
}
