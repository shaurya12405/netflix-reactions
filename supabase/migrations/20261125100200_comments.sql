-- Timestamped comments. Clients never INSERT or UPDATE directly: from M3 the
-- `post-comment` Edge Function (service role) validates, moderates and inserts.
-- No editing in v1 (an edit would bypass moderation).
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  video_id text not null,
  ts_seconds numeric(9, 3) not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  parent_id uuid references public.comments (id) on delete cascade,
  text text not null,
  is_spoiler boolean not null default false,
  like_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint comments_video_id_format
    check (video_id ~ '^[a-z][a-z0-9]{1,19}:[A-Za-z0-9_-]{1,64}$'),
  constraint comments_ts_range check (ts_seconds >= 0 and ts_seconds < 86400),
  constraint comments_text_length check (char_length(text) between 1 and 200 and text ~ '\S'),
  constraint comments_like_count_nonnegative check (like_count >= 0),
  constraint comments_not_own_parent check (parent_id is null or parent_id <> id)
);

create index comments_video_ts_idx on public.comments (video_id, ts_seconds);
create index comments_user_created_idx on public.comments (user_id, created_at desc);
create index comments_parent_idx on public.comments (parent_id) where parent_id is not null;

alter table public.comments enable row level security;

revoke all on table public.comments from anon, authenticated;
grant select on table public.comments to anon, authenticated;
grant delete on table public.comments to authenticated;

create policy "Comments are readable by everyone"
  on public.comments for select
  to anon, authenticated
  using (true);

create policy "Users delete their own comments"
  on public.comments for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Server-side invariants, whoever inserts (Edge Function or SQL editor):
-- created_at and like_count cannot be forged, replies are one level deep and
-- on the same video, and at most 5 comments per user per minute.
create function private.comments_before_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_video text;
  parent_parent uuid;
begin
  new.created_at := now();
  new.like_count := 0;

  if new.parent_id is not null then
    select c.video_id, c.parent_id into parent_video, parent_parent
      from public.comments c where c.id = new.parent_id;
    if not found then
      raise exception 'parent comment does not exist' using errcode = 'ST404';
    end if;
    if parent_parent is not null then
      raise exception 'replies can only be one level deep' using errcode = 'ST400';
    end if;
    if parent_video <> new.video_id then
      raise exception 'a reply must be on the same video as its parent' using errcode = 'ST400';
    end if;
  end if;

  perform private.enforce_rate_limit('public.comments', new.user_id, 5, interval '1 minute');
  return new;
end;
$$;
revoke all on function private.comments_before_insert() from public;

create trigger comments_before_insert
  before insert on public.comments
  for each row execute function private.comments_before_insert();
