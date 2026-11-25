begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select ok(has_table_privilege('service_role', 'public.comments', 'INSERT'), 'service role can insert comments');
select ok(has_table_privilege('service_role', 'public.comments', 'SELECT'), 'service role can read comments');
select ok(has_table_privilege('service_role', 'public.profiles', 'SELECT'), 'service role can read profiles');

select * from finish();
rollback;
