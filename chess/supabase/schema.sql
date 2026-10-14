-- Chess Tutor: run this once in Supabase → SQL Editor → New query → Run.

create table if not exists profiles (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists games (
  id text primary key,
  profile_id text not null references profiles(id) on delete cascade,
  summary jsonb not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists games_profile_idx on games (profile_id, created_at desc);

-- Family setup with no passwords: the app's public key may read and write
-- these two tables. Anyone who has both the site address and the key could
-- too, so don't store anything private here. Proper logins can come later.
alter table profiles enable row level security;
alter table games enable row level security;

drop policy if exists "family access" on profiles;
create policy "family access" on profiles for all to anon using (true) with check (true);

drop policy if exists "family access" on games;
create policy "family access" on games for all to anon using (true) with check (true);
