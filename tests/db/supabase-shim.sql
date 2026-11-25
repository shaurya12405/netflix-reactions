-- LOCAL TESTING ONLY. A minimal stand-in for the parts of a Supabase database
-- the migrations rely on, so they can be tested on plain Postgres (CI and this
-- repo's scripts/test-db.sh) without Docker. Never run this against a real
-- Supabase project: those already have all of this.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text
);

-- Same resolution order as Supabase's auth.uid().
create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema extensions;
create extension pgtap with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Supabase's default grants: client roles get everything on new public
-- objects, and RLS + explicit revokes do the restricting. Reproducing this
-- matters: it proves the migrations' revokes actually take effect.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
