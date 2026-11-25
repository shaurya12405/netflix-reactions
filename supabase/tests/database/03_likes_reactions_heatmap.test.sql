-- Likes (counter via SECURITY DEFINER trigger), reactions, heatmap RPC.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
  ('10000000-0000-4000-8000-000000000001', 'netflix:1', 10, '00000000-0000-4000-8000-00000000000a', 'like me');

-- Likes
select pg_temp.act_as('00000000-0000-4000-8000-00000000000b');
select lives_ok(
  $$insert into public.likes (user_id, comment_id) values ('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001')$$,
  'a user can like someone else''s comment'
);
select is(
  (select like_count from public.comments where id = '10000000-0000-4000-8000-000000000001'), 1,
  'like_count goes up although the liker cannot update comments (SECURITY DEFINER trigger)'
);
select throws_ok(
  $$insert into public.likes (user_id, comment_id) values ('00000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a user cannot like on someone else''s behalf'
);
select throws_ok(
  $$insert into public.likes (user_id, comment_id) values ('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'a comment can only be liked once per user'
);

select pg_temp.act_as('00000000-0000-4000-8000-00000000000a');
insert into public.likes (user_id, comment_id) values ('00000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.likes), 1, 'users only see their own likes');

select pg_temp.act_as_anon();
select throws_ok('select * from public.likes', '42501', null, 'signed-out visitors cannot read likes');
select is(
  (select like_count from public.comments where id = '10000000-0000-4000-8000-000000000001'), 2,
  'signed-out visitors see the total like count'
);

select pg_temp.act_as('00000000-0000-4000-8000-00000000000b');
delete from public.likes where comment_id = '10000000-0000-4000-8000-000000000001';
select is(
  (select like_count from public.comments where id = '10000000-0000-4000-8000-000000000001'), 1,
  'unliking decrements like_count (and only removes your own like)'
);

-- Reactions
select lives_ok(
  $$insert into public.reactions (video_id, ts_seconds, emoji) values ('netflix:1', 5, 'fire')$$,
  'a user can react; user_id defaults to the caller'
);
select is(
  (select user_id::text from public.reactions limit 1), '00000000-0000-4000-8000-00000000000b',
  'the reaction is attributed to the caller'
);
select throws_ok(
  $$insert into public.reactions (video_id, ts_seconds, user_id, emoji) values ('netflix:1', 5, '00000000-0000-4000-8000-00000000000a', 'cry')$$,
  '42501', null, 'a user cannot react as someone else'
);
select lives_ok(
  $$insert into public.reactions (video_id, ts_seconds, emoji) select 'netflix:1', g, 'laugh' from generate_series(1, 19) g$$,
  'twenty reactions in a minute are allowed'
);
select throws_ok(
  $$insert into public.reactions (video_id, ts_seconds, emoji) values ('netflix:1', 50, 'shock')$$,
  'ST429', null, 'the 21st reaction within a minute is rejected'
);

select pg_temp.act_as_anon();
select throws_ok(
  'select user_id from public.reactions', '42501', null,
  'signed-out visitors cannot see who reacted'
);

-- Heatmap: 10-second buckets, comments + reactions.
reset role;
insert into public.comments (video_id, ts_seconds, user_id, text) values
  ('netflix:2', 3, '00000000-0000-4000-8000-00000000000a', 'a'),
  ('netflix:2', 9.999, '00000000-0000-4000-8000-00000000000a', 'b'),
  ('netflix:2', 12, '00000000-0000-4000-8000-00000000000a', 'c');
select pg_temp.act_as('00000000-0000-4000-8000-00000000000a');
insert into public.reactions (video_id, ts_seconds, emoji) values ('netflix:2', 5, 'fire'), ('netflix:2', 25, 'cry');

select pg_temp.act_as_anon();
select results_eq(
  $$select * from public.heatmap('netflix:2')$$,
  $$values (0, 2, 1), (10, 1, 0), (20, 0, 1)$$,
  'heatmap counts comments and reactions per 10-second bucket (callable signed out)'
);
select is_empty(
  $$select * from public.heatmap('netflix:404')$$,
  'heatmap of a video without activity is empty'
);

select * from finish();
rollback;
