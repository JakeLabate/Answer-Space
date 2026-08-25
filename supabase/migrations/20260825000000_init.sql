/* Answer Space — accounts, per-user config, encrypted keys, snapshot history.

   Every table is keyed by auth.uid() and gated by RLS, so a user physically
   cannot read another user's rows even with a stolen publishable key. The
   client only ever holds the publishable (anon) key; nothing here trusts it.

   Storage shape mirrors the local engine deliberately: the browser keeps
   ans:/ext:/ver: per date in IndexedDB and rebuilds the bundle from them, so
   the cloud stores the same raw material per date and rebuilds the same way.
   The built bundle is derived, never stored — one source of truth. */

-- ── who ──────────────────────────────────────────────────────────────
create table public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

-- ── the wizard's state: profile, query set, ground truth, scan config ─
create table public.workspaces (
  user_id    uuid primary key references auth.users on delete cascade default auth.uid(),
  site       text not null default '',
  hint       text not null default '',
  profile    jsonb,
  prompts    jsonb,
  facts      text not null default '',
  scan       jsonb not null default '{"q":20,"r":3,"verify":true,"verifyMax":40}'::jsonb,
  models     jsonb not null default '{}'::jsonb,
  step       text  not null default 'keys',
  updated_at timestamptz not null default now()
);

-- ── vendor API keys, encrypted at rest ───────────────────────────────
-- Ciphertext is AES-256-GCM. The master key lives only in the `keys` Edge
-- Function's environment — not in this database and not in the client — so a
-- database leak alone does not yield anyone's vendor keys. `hint` is the last
-- four characters, kept in clear so the UI can show which key is set.
create table public.api_keys (
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  provider   text not null,
  ciphertext text not null,
  iv         text not null,
  hint       text,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

-- ── one row per collection run, per date ─────────────────────────────
-- `raw` holds {answers, extractions, verifications} for that date — enough to
-- rebuild the bundle on any device. The summary columns beside it are
-- denormalised at write time so the trend chart never has to download `raw`.
create table public.snapshots (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users on delete cascade default auth.uid(),
  taken_on           date not null,
  raw                jsonb not null default '{}'::jsonb,
  answers            int  not null default 0,
  citations          int  not null default 0,
  mentioned          int  not null default 0,
  recommended        int  not null default 0,
  refused            int  not null default 0,
  avg_tone           numeric,
  unsupported        int  not null default 0,
  fact_conflicts     int  not null default 0,
  risk_flags         int  not null default 0,
  wins               int  not null default 0,
  losses             int  not null default 0,
  flipped            int  not null default 0,
  verified           boolean not null default false,
  has_facts          boolean not null default false,
  demo               boolean not null default false,
  prompt_set_version int,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, taken_on)
);

-- ── per platform × theme, so trends can be sliced without parsing raw ─
create table public.snapshot_metrics (
  snapshot_id uuid not null references public.snapshots on delete cascade,
  user_id     uuid not null references auth.users on delete cascade default auth.uid(),
  platform    text not null,
  theme       text not null,
  answers     int not null default 0,
  mentioned   int not null default 0,
  recommended int not null default 0,
  primary key (snapshot_id, platform, theme)
);

create index snapshots_user_date_idx on public.snapshots (user_id, taken_on desc);
create index snapshot_metrics_user_idx on public.snapshot_metrics (user_id);

-- ── RLS: you see your rows and nobody else's ─────────────────────────
alter table public.profiles         enable row level security;
alter table public.workspaces       enable row level security;
alter table public.api_keys         enable row level security;
alter table public.snapshots        enable row level security;
alter table public.snapshot_metrics enable row level security;

create policy "own profile"   on public.profiles
  for all to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "own workspace" on public.workspaces
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own snapshots" on public.snapshots
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own metrics"   on public.snapshot_metrics
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- api_keys is readable by its owner only for the `hint` column in practice;
-- decryption happens in the Edge Function under the service role. Owners may
-- read their ciphertext rows (useless without the master key) and delete them.
create policy "own api keys" on public.api_keys
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ── a profile + empty workspace the moment someone signs up ──────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
    on conflict (id) do nothing;
  insert into public.workspaces (user_id) values (new.id)
    on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── touch updated_at ─────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger workspaces_touch before update on public.workspaces
  for each row execute function public.touch_updated_at();
create trigger snapshots_touch before update on public.snapshots
  for each row execute function public.touch_updated_at();
create trigger api_keys_touch before update on public.api_keys
  for each row execute function public.touch_updated_at();

/* Both of the above are trigger functions and nothing else. PostgreSQL does not
   check EXECUTE on a trigger function when the trigger fires, so revoking it
   stops /rest/v1/rpc/handle_new_user being callable over the REST API while
   leaving signup working exactly as before. */
revoke execute on function public.handle_new_user()  from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
