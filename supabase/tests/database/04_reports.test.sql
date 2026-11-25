-- Reports: insert as yourself, once per comment, visible only to the reporter.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

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

insert into auth.users (id) values
  ('00000000-0000-4000-8000-00000000000a'), ('00000000-0000-4000-8000-00000000000b');
insert into public.profiles (id, display_name) values
  ('00000000-0000-4000-8000-00000000000a', 'alice'), ('00000000-0000-4000-8000-00000000000b', 'bob');
insert into public.comments (id, video_id, ts_seconds, user_id, text) values
  ('10000000-0000-4000-8000-000000000001', 'netflix:1', 10, '00000000-0000-4000-8000-00000000000b', 'rude');

select pg_temp.act_as('00000000-0000-4000-8000-00000000000a');
select lives_ok(
  $$insert into public.reports (comment_id, reason) values ('10000000-0000-4000-8000-000000000001', 'harassment')$$,
  'a user can report a comment'
);
select throws_ok(
  $$insert into public.reports (comment_id, reason) values ('10000000-0000-4000-8000-000000000001', 'spam')$$,
  '23505', null, 'a user can report a comment only once'
);
select throws_ok(
  $$insert into public.reports (comment_id, reporter_id, reason) values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'spam')$$,
  '42501', null, 'a user cannot report on someone else''s behalf'
);
select is((select count(*)::int from public.reports), 1, 'the reporter sees their report');

select pg_temp.act_as('00000000-0000-4000-8000-00000000000b');
select is((select count(*)::int from public.reports), 0, 'other users cannot see who reported them');

select pg_temp.act_as_anon();
select throws_ok(
  $$insert into public.reports (comment_id, reason) values ('10000000-0000-4000-8000-000000000001', 'spam')$$,
  '42501', null, 'signed-out visitors cannot report'
);

reset role;
delete from auth.users where id = '00000000-0000-4000-8000-00000000000b';
select is(
  (select count(*)::int from public.comments where user_id = '00000000-0000-4000-8000-00000000000b'), 0,
  'deleting an account removes its comments (and their reports)'
);

select * from finish();
rollback;
