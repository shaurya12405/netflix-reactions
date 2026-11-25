-- Scene Talk: shared building blocks.
--
-- `private` holds trigger functions and helpers. It is not exposed through the
-- Supabase Data API, and the client roles (anon, authenticated) get no access.
create schema if not exists private;
revoke all on schema private from public;

create type public.reaction_emoji as enum ('laugh', 'shock', 'cry', 'fire');
create type public.report_reason as enum ('spoiler', 'harassment', 'hate', 'spam', 'other');

-- Video IDs are namespaced by platform, e.g. 'netflix:80100172', so other
-- platforms can be added later without collisions. This exact pattern is
-- repeated in each table's CHECK constraint (constraints cannot call functions
-- in `private`, because the inserting role has no access to that schema).
comment on schema private is
  'Internal helpers for Scene Talk. Video ID pattern: ^[a-z][a-z0-9]{1,19}:[A-Za-z0-9_-]{1,64}$';

-- Per-user rate limit, shared by comments and reactions. Serialises a user's
-- concurrent inserts with a transaction-scoped advisory lock so two parallel
-- requests cannot both slip under the limit.
create function private.enforce_rate_limit(
  p_table regclass,
  p_user_id uuid,
  p_max integer,
  p_window interval
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_table::text || ':' || p_user_id::text, 0));
  execute format(
    'select count(*) from %s where user_id = $1 and created_at > now() - $2',
    p_table
  ) into recent using p_user_id, p_window;
  if recent >= p_max then
    raise exception 'rate limit: at most % per %', p_max, p_window
      using errcode = 'ST429', hint = 'Wait a moment and try again.';
  end if;
end;
$$;
revoke all on function private.enforce_rate_limit(regclass, uuid, integer, interval) from public;
