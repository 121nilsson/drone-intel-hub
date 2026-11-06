-- The person's second look at an answer the second reader contradicted (the audit page's
-- "where you and the reader disagree"): 'stands' - the first answer was right and the reader
-- wrong - or 'reader_right' - the reader caught something the first answer missed.
--
-- It is a note about the reader and about the person's own habits. It never replaces `answer`:
-- the audit's numbers are the first answers, and nothing that decides or learns reads this.
--
-- Idempotent: the column is added only if missing.

alter table verification_audit add column if not exists second_look text
  check (second_look in ('stands', 'reader_right'));
