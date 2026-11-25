-- Live updates: new comments are broadcast to subscribers of their video via
-- Supabase Realtime (Postgres Changes). Realtime applies each subscriber's
-- RLS, so this exposes nothing beyond what SELECT already allows.
alter publication supabase_realtime add table public.comments;
