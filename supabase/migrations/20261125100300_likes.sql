create table public.likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  comment_id uuid not null references public.comments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, comment_id)
);

create index likes_comment_idx on public.likes (comment_id);

alter table public.likes enable row level security;

revoke all on table public.likes from anon, authenticated;
grant select, delete on table public.likes to authenticated;
grant insert (user_id, comment_id) on table public.likes to authenticated;

-- Users only see their own likes (enough to show "you liked this");
-- totals come from comments.like_count.
create policy "Users see their own likes"
  on public.likes for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users like as themselves"
  on public.likes for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users remove their own likes"
  on public.likes for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- SECURITY DEFINER: the liker usually does not own the comment, and has no
-- UPDATE privilege on comments at all; this function updates the counter on
-- their behalf, and nothing else.
create function private.likes_maintain_count() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.comments set like_count = like_count + 1 where id = new.comment_id;
    return new;
  end if;
  update public.comments set like_count = greatest(like_count - 1, 0) where id = old.comment_id;
  return old;
end;
$$;
revoke all on function private.likes_maintain_count() from public;

create trigger likes_maintain_count
  after insert or delete on public.likes
  for each row execute function private.likes_maintain_count();
