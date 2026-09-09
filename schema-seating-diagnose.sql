-- READ-ONLY. Answers the one question a browser cannot: is the seating board's
-- data gone, or is it there and being hidden? Both look like an empty board.
--
-- Run this in the Supabase SQL Editor and send back the four result sets. The
-- SQL Editor runs as a privileged role, so it sees rows regardless of the
-- policies a browser is subject to -- which is exactly what makes it able to
-- tell the two cases apart. It changes nothing.

-- 1. WHAT IS THERE. If people > 0 the roster still exists and the problem is
--    access, not loss. If people = 0 the rows are genuinely gone.
select collection, count(*) as rows, max(updated_at) as last_write
  from public.app_data
 where app = 'b100-seating'
 group by collection
 order by collection;

-- 2. THE NAMES, if any. Confirms it is the real roster and not a stub.
select doc_id, data->>'name' as name, data->>'dept' as dept, updated_at
  from public.app_data
 where app = 'b100-seating' and collection = 'people'
 order by updated_at
 limit 100;

-- 3. WHO CAN SEE THEM. `visibility` must be 'shared'; a row at 'private' with a
--    null owner is readable by nobody at all through the app.
select visibility, owner is null as owner_is_null, count(*) as rows
  from public.app_data
 where app = 'b100-seating'
 group by visibility, owner is null
 order by visibility;

-- 4. THE POLICIES IN FORCE. The board talks as `anon`, so an "anon all
--    app_data" row granting ALL must be present. If it is missing, that alone
--    explains an empty board for every visitor -- run schema-anon-restore.sql.
select policyname, cmd, roles::text
  from pg_policies
 where schemaname = 'public' and tablename = 'app_data'
 order by policyname;
