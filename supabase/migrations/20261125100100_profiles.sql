-- Public profile: just a chosen display name. Never the email.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  constraint profiles_display_name_format
    check (display_name ~ '^[A-Za-z0-9_.]{3,20}$'),
  constraint profiles_display_name_dots
    check (display_name !~ '(^\.|\.$|\.\.)'),
  constraint profiles_display_name_not_reserved
    check (lower(display_name) not in (
      'admin', 'administrator', 'mod', 'moderator', 'support', 'system', 'official',
      'scenetalk', 'scene_talk', 'scene.talk', 'netflix', 'anonymous', 'deleted'
    ))
);

-- Case-insensitive uniqueness: "Mira" and "mira" cannot both exist.
create unique index profiles_display_name_lower_key on public.profiles (lower(display_name));

alter table public.profiles enable row level security;

-- Column-level grants: clients can only ever see id + display_name.
revoke all on table public.profiles from anon, authenticated;
grant select (id, display_name) on table public.profiles to anon, authenticated;
grant insert (id, display_name) on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;
grant delete on table public.profiles to authenticated;

create policy "Profiles are readable by everyone"
  on public.profiles for select
  to anon, authenticated
  using (true);

create policy "Users create their own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "Users update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Users delete their own profile"
  on public.profiles for delete
  to authenticated
  using ((select auth.uid()) = id);
