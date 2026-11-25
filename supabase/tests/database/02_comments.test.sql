-- Comments: no direct client writes, server-side invariants, replies, rate limit.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

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

-- alice, bob, carol (rate-limit subject), dave (deletion subject)
insert into auth.users (id) values
  ('00000000-0000-4000-8000-00000000000a'), ('00000000-0000-4000-8000-00000000000b'),
  ('00000000-0000-4000-8000-00000000000c'), ('00000000-0000-4000-8000-00000000000d');
insert into public.profiles (id, display_name) values
  ('00000000-0000-4000-8000-00000000000a', 'alice'), ('00000000-0000-4000-8000-00000000000b', 'bob'),
  ('00000000-0000-4000-8000-00000000000c', 'carol'), ('00000000-0000-4000-8000-00000000000d', 'dave');
insert into public.comments (id, video_id, ts_seconds, user_id, text) values
  ('10000000-0000-4000-8000-000000000001', 'netflix:1', 10, '00000000-0000-4000-8000-00000000000a', 'parent'),
  ('10000000-0000-4000-8000-000000000002', 'netflix:1', 20, '00000000-0000-4000-8000-00000000000b', 'bob says hi'),
  ('10000000-0000-4000-8000-0000000000d1', 'netflix:1', 30, '00000000-0000-4000-8000-00000000000d', 'dave was here');

-- Clients cannot write directly.
select pg_temp.act_as('00000000-0000-4000-8000-00000000000a');
select throws_ok(
  $$insert into public.comments (video_id, ts_seconds, user_id, text) values ('netflix:1', 1, '00000000-0000-4000-8000-00000000000a', 'hi')$$,
  '42501', null, 'signed-in users cannot insert comments directly (Edge Function only)'
);
select throws_ok(
  $$update public.comments set text = 'edited' where id = '10000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'comments cannot be edited, not even by their author'
);

select pg_temp.act_as_anon();
select is((select count(*)::int from public.comments), 3, 'signed-out visitors can read comments');
select throws_ok(
  $$delete from public.comments$$, '42501', null, 'signed-out visitors cannot delete'
);

-- Server-side inserts (the Edge Function uses the service role).
reset role;
set local role service_role;
select lives_ok(
  $$insert into public.comments (id, video_id, ts_seconds, user_id, text, like_count, created_at)
    values ('10000000-0000-4000-8000-000000000003', 'netflix:1', 12.5, '00000000-0000-4000-8000-00000000000a', 'forged', 99, '2000-01-01')$$,
  'the service role can insert'
);
select results_eq(
  $$select like_count, created_at = now() from public.comments where id = '10000000-0000-4000-8000-000000000003'$$,
  $$values (0, true)$$,
  'like_count and created_at cannot be forged on insert'
);

select lives_ok(
  $$insert into public.comments (id, video_id, ts_seconds, user_id, parent_id, text)
    values ('10000000-0000-4000-8000-000000000004', 'netflix:1', 15, '00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', 'reply')$$,
  'a reply on the same video is accepted'
);
select throws_ok(
  $$insert into public.comments (video_id, ts_seconds, user_id, parent_id, text)
    values ('netflix:1', 16, '00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000004', 'nested')$$,
  'ST400', 'replies can only be one level deep', 'replies to replies are rejected'
);
select throws_ok(
  $$insert into public.comments (video_id, ts_seconds, user_id, parent_id, text)
    values ('netflix:2', 16, '00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', 'elsewhere')$$,
  'ST400', 'a reply must be on the same video as its parent', 'replies on another video are rejected'
);
select throws_ok(
  $$insert into public.comments (video_id, ts_seconds, user_id, parent_id, text)
    values ('netflix:1', 16, '00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-0000000000ff', 'orphan')$$,
  'ST404', 'parent comment does not exist', 'replies to a missing parent are rejected'
);

select throws_ok(
  $$insert into public.comments (video_id, ts_seconds, user_id, text) values ('netflix:1', 1, '00000000-0000-4000-8000-00000000000b', '   ')$$,
  '23514', null, 'whitespace-only text is rejected'
);
select throws_ok(
  format($$insert into public.comments (video_id, ts_seconds, user_id, text) values ('netflix:1', 1, '00000000-0000-4000-8000-00000000000b', %L)$$, repeat('x', 201)),
  '23514', null, 'text over 200 characters is rejected'
);
select lives_ok(
  format($$insert into public.comments (video_id, ts_seconds, user_id, text) values ('netflix:1', 1, '00000000-0000-4000-8000-00000000000a', %L)$$, repeat('x', 200)),
  'text of exactly 200 characters is accepted'
);
select throws_ok(
  $$insert into public.comments (video_id, ts_seconds, user_id, text) values ('netflix:1', -1, '00000000-0000-4000-8000-00000000000b', 'neg')$$,
  '23514', null, 'negative timestamps are rejected'
);
select throws_ok(
  $$insert into public.comments (video_id, ts_seconds, user_id, text) values ('Netflix 1', 1, '00000000-0000-4000-8000-00000000000b', 'bad id')$$,
  '23514', null, 'malformed video IDs are rejected'
);

-- Rate limit: 5 per user per minute.
select lives_ok(
  $$insert into public.comments (video_id, ts_seconds, user_id, text)
    select 'netflix:1', g, '00000000-0000-4000-8000-00000000000c', 'spam ' || g from generate_series(1, 5) g$$,
  'five comments in a minute are allowed'
);
select throws_ok(
  $$insert into public.comments (video_id, ts_seconds, user_id, text) values ('netflix:1', 6, '00000000-0000-4000-8000-00000000000c', 'sixth')$$,
  'ST429', null, 'the sixth comment within a minute is rejected'
);
select lives_ok(
  $$insert into public.comments (video_id, ts_seconds, user_id, text) values ('netflix:1', 6, '00000000-0000-4000-8000-00000000000b', 'other user')$$,
  'the limit is per user'
);

-- Deleting: own only.
reset role;
select pg_temp.act_as('00000000-0000-4000-8000-00000000000a');
delete from public.comments where id = '10000000-0000-4000-8000-0000000000d1';
select pg_temp.act_as('00000000-0000-4000-8000-00000000000d');
select lives_ok(
  $$delete from public.comments where id = '10000000-0000-4000-8000-000000000001'$$,
  'deleting someone else''s comment does nothing (no error)'
);
reset role;
select results_eq(
  $$select id::text from public.comments where id in ('10000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-000000000001') order by 1$$,
  $$values ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-0000000000d1')$$,
  'both comments survive attempts by non-authors'
);

select * from finish();
rollback;
