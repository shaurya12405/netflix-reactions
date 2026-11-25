create table public.reactions (
  id uuid primary key default gen_random_uuid(),
  video_id text not null,
  ts_seconds numeric(9, 3) not null,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  emoji public.reaction_emoji not null,
  created_at timestamptz not null default now(),
  constraint reactions_video_id_format
    check (video_id ~ '^[a-z][a-z0-9]{1,19}:[A-Za-z0-9_-]{1,64}$'),
  constraint reactions_ts_range check (ts_seconds >= 0 and ts_seconds < 86400)
);

create index reactions_video_ts_idx on public.reactions (video_id, ts_seconds);
create index reactions_user_created_idx on public.reactions (user_id, created_at desc);

alter table public.reactions enable row level security;

revoke all on table public.reactions from anon, authenticated;
-- Signed-out viewers see reactions but not who made them.
grant select (id, video_id, ts_seconds, emoji, created_at) on table public.reactions to anon;
grant select, delete on table public.reactions to authenticated;
grant insert (video_id, ts_seconds, user_id, emoji) on table public.reactions to authenticated;

create policy "Reactions are readable by everyone"
  on public.reactions for select
  to anon, authenticated
  using (true);

create policy "Users react as themselves"
  on public.reactions for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users remove their own reactions"
  on public.reactions for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create function private.reactions_before_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := now();
  perform private.enforce_rate_limit('public.reactions', new.user_id, 20, interval '1 minute');
  return new;
end;
$$;
revoke all on function private.reactions_before_insert() from public;

create trigger reactions_before_insert
  before insert on public.reactions
  for each row execute function private.reactions_before_insert();
