-- Correct the endpoint of sources that were silently returning nothing, and retire one that
-- duplicated another source's content.
--
-- Why a migration rather than a seed edit: SEED_SOURCES only ever ADDS rows
-- (LocalSourceRepository.addMissingDefaults), so an install that already stored these sources
-- keeps polling the old handle forever. Three of them had been dead that way, and none of them
-- looked broken - the Sources page showed them as reachable with 0 posts, because a feed that
-- answers 200 with no items is not an error. Verified 2026-10-10 against the live feeds.
--
-- ukrinform-war: /rss/rubric-war 302s to a 404 page. /rss/rubric-ato is the Armed Forces rubric
--   and answers 200 with 20 items, 5 passing DRONE_HINT.
-- aerovironment: the /news/ index page is scraped for anchor text, which yielded 25 "posts" of
--   which 1 was an article and the rest was navigation chrome. /feed/ yields 10 real items, 6
--   passing DRONE_HINT, including procurement-grade items (LOCUST counter-UAS contract,
--   Switchblade 600 order).
-- quantum-systems: same index-page problem (22 anchors, 5 articles) plus intermittent 403s.
--   /feed/ is stable across repeated fetches and yields 10 items, 7 passing DRONE_HINT.
-- bellingcat-news: removed from the seed. It is a strict subset of bellingcat's site-wide feed
--   (9 of its 10 items also appear there, same guid and same link). Marked autoSync=false rather
--   than deleted so the archive keeps showing that the site carried those stories; the row can be
--   deleted by hand once nobody needs that history.
-- ukrinform-main: kept but still disabled; /rss answers 404, so re-enabling it without a new
--   handle would resurrect a dead source. Left as-is deliberately - it is opt-in and off.
--
-- Idempotency and repair: `platform` and `handle` are mirrored columns (postgres-store.server.ts),
-- and the previous statement to run may have written the document without the column or vice
-- versa. So each predicate tests the COLUMN, which is the value the fetcher actually reads, and
-- each statement writes BOTH. Re-running this file therefore repairs a half-applied state rather
-- than skipping it - and once the column holds the new handle, no statement matches again.
--
-- The predicates pin the OLD handle on purpose. Beyond idempotency, that leaves alone an operator
-- who has deliberately pointed the source somewhere else since this migration was written.

update sources
   set platform = 'RSS',
       handle   = 'https://www.ukrinform.net/rss/rubric-ato',
       data     = jsonb_set(jsonb_set(data, '{platform}', '"RSS"'::jsonb), '{handle}', '"https://www.ukrinform.net/rss/rubric-ato"'::jsonb)
 where data->>'id' = 'ukrinform-war'
   and handle = 'https://www.ukrinform.net/rss/rubric-war';

update sources
   set platform = 'RSS',
       handle   = 'https://www.avinc.com/feed/',
       data     = jsonb_set(jsonb_set(data, '{platform}', '"RSS"'::jsonb), '{handle}', '"https://www.avinc.com/feed/"'::jsonb)
 where data->>'id' = 'aerovironment'
   and handle = 'https://www.avinc.com/news/';

update sources
   set platform = 'RSS',
       handle   = 'https://quantum-systems.com/feed/',
       data     = jsonb_set(jsonb_set(data, '{platform}', '"RSS"'::jsonb), '{handle}', '"https://quantum-systems.com/feed/"'::jsonb)
 where data->>'id' = 'quantum-systems'
   and handle = 'https://quantum-systems.com/news/';

update sources
   set data = jsonb_set(data, '{autoSync}', 'false'::jsonb)
 where data->>'id' = 'bellingcat-news'
   and coalesce(data->>'autoSync', 'true') <> 'false';

-- autoSync has no mirrored column - it is a document field only, like lastError.