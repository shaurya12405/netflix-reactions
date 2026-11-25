-- Make the service role's table privileges explicit. The post-comment Edge
-- Function writes with it; older Supabase projects grant these by default,
-- but newer projects may not expose new tables to the API roles
-- automatically, which made inserts fail with 42501. RLS is bypassed by this
-- role by design; the Edge Function validates everything itself.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant execute on function public.heatmap(text) to service_role;
