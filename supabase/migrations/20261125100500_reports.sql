-- Reports are reviewed in the Supabase dashboard. Auto-hiding after repeated
-- reports arrives with moderation in M4.
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments (id) on delete cascade,
  reporter_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reason public.report_reason not null,
  details text,
  created_at timestamptz not null default now(),
  constraint reports_details_length check (details is null or char_length(details) <= 500),
  constraint reports_one_per_user unique (comment_id, reporter_id)
);

create index reports_comment_idx on public.reports (comment_id);

alter table public.reports enable row level security;

revoke all on table public.reports from anon, authenticated;
grant select on table public.reports to authenticated;
grant insert (comment_id, reporter_id, reason, details) on table public.reports to authenticated;

create policy "Users see their own reports"
  on public.reports for select
  to authenticated
  using ((select auth.uid()) = reporter_id);

create policy "Users report as themselves"
  on public.reports for insert
  to authenticated
  with check ((select auth.uid()) = reporter_id);
