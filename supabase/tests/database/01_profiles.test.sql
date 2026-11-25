-- Profiles: display-name rules and RLS.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- Act as a signed-in user / a signed-out visitor (Supabase JWT claims + role).
create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.com');

select ok(
  (select bool_and(relrowsecurity) from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'),
  'RLS is enabled on every public table'
);

select pg_temp.act_as('00000000-0000-4000-8000-00000000000a');
select lives_ok(
  $$insert into public.profiles (id, display_name) values ('00000000-0000-4000-8000-00000000000a', 'Mira_K')$$,
  'a user can create their own profile'
);
select throws_ok(
  $$insert into public.profiles (id, display_name) values ('00000000-0000-4000-8000-00000000000b', 'bobby')$$,
  '42501', null, 'a user cannot create a profile for someone else'
);

select pg_temp.act_as('00000000-0000-4000-8000-00000000000b');
select throws_ok(
  $$insert into public.profiles (id, display_name) values ('00000000-0000-4000-8000-00000000000b', 'mira_k')$$,
  '23505', null, 'display names are unique ignoring case'
);
select throws_ok(
  $$insert into public.profiles (id, display_name) values ('00000000-0000-4000-8000-00000000000b', 'bo b')$$,
  '23514', null, 'display names reject spaces'
);
select throws_ok(
  $$insert into public.profiles (id, display_name) values ('00000000-0000-4000-8000-00000000000b', 'Admin')$$,
  '23514', null, 'reserved display names are rejected'
);
select throws_ok(
  $$insert into public.profiles (id, display_name) values ('00000000-0000-4000-8000-00000000000b', '.bob')$$,
  '23514', null, 'display names cannot start with a dot'
);
select lives_ok(
  $$insert into public.profiles (id, display_name) values ('00000000-0000-4000-8000-00000000000b', 'bob.watches')$$,
  'a valid second profile is accepted'
);

select pg_temp.act_as_anon();
select results_eq(
  'select display_name from public.profiles order by 1',
  $$values ('Mira_K'::text), ('bob.watches'::text)$$,
  'signed-out visitors can read display names'
);
select throws_ok(
  'select created_at from public.profiles',
  '42501', null, 'only id and display_name are exposed'
);

select pg_temp.act_as('00000000-0000-4000-8000-00000000000a');
select lives_ok(
  $$update public.profiles set display_name = 'mira.k' where id = '00000000-0000-4000-8000-00000000000a'$$,
  'a user can rename themselves'
);
update public.profiles set display_name = 'hacked' where id = '00000000-0000-4000-8000-00000000000b';
delete from public.profiles where id = '00000000-0000-4000-8000-00000000000b';
reset role;
select is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-00000000000b'),
  'bob.watches',
  'a user cannot rename or delete someone else'
);

delete from auth.users where id = '00000000-0000-4000-8000-00000000000a';
select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-4000-8000-00000000000a'),
  0,
  'deleting the auth user deletes their profile'
);

select * from finish();
rollback;
