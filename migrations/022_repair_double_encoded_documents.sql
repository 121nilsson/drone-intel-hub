-- Repair documents whose `data` was stored as a JSON string holding the document, instead of the
-- document itself ("{\"id\": ...}" rather than {"id": ...}).
--
-- scripts/rename-legacy-system-ids.ts passed JSON.stringify(doc) as a parameter to `$1::jsonb`,
-- which postgres.js then encoded a second time. A reader gets a string where it expects a document,
-- so every field is undefined: one such dispatch stopped the whole sync tick with "Cannot read
-- properties of undefined (reading 'replace')". The script now writes through tx.json().
--
-- Only strings that start with "{" are touched, so a value that is not a document cannot make the
-- cast fail and block the migration. Idempotent: once repaired, no row is a string any more.

update candidates set data = (data #>> '{}')::jsonb
  where jsonb_typeof(data) = 'string' and left(data #>> '{}', 1) = '{';

update dispatches set data = (data #>> '{}')::jsonb
  where jsonb_typeof(data) = 'string' and left(data #>> '{}', 1) = '{';

update drones set data = (data #>> '{}')::jsonb
  where jsonb_typeof(data) = 'string' and left(data #>> '{}', 1) = '{';

update procurements set data = (data #>> '{}')::jsonb
  where jsonb_typeof(data) = 'string' and left(data #>> '{}', 1) = '{';
