-- Near-duplicate fingerprint for collected posts.
--
-- The same story routinely arrives three times over: a Telegram channel, an RSS feed and a news
-- site all report one event within minutes. Ingesting all three costs three extractions and,
-- worse, records three SpecClaims each citing a different source - so consensus() counts one
-- fact three times and clears its "high confidence" gate on a single report.
--
-- `content_hash` is a 64-bit SimHash of the normalised text, so copies that differ in framing
-- and boilerplate are still recognised. See src/entities/dispatch/simhash.ts for the tolerance
-- and the measurements behind it.
--
-- The column lives outside the jsonb document for the same reason as source_id, status and the
-- lease fields: it is mirrored metadata the claim and any future lookup can use directly, and a
-- browser writing a stale cached document cannot clobber it.
--
-- Documents stored before this migration carry no fingerprint. They are fingerprinted lazily on
-- read (LocalDispatchRepository), so no backfill is required for dedupe to work.

alter table dispatches add column if not exists content_hash text;

create index if not exists dispatches_content_hash_idx
  on dispatches (content_hash) where content_hash is not null;
