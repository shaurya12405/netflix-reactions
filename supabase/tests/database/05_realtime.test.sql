begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

select ok(
  exists (select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments'),
  'comments are published to Realtime'
);
select ok(
  not exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename in ('likes', 'reports')),
  'likes and reports are not broadcast'
);

select * from finish();
rollback;
