-- Custom emission factors (user-saved) — run in Supabase SQL editor
-- Requires: auth.users

create table if not exists public.custom_emission_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  value_kg_co2e_per_unit double precision not null,
  activity_unit text not null,
  source text not null default '',
  group_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists custom_emission_factors_user_id_idx
  on public.custom_emission_factors (user_id);

create index if not exists custom_emission_factors_group_id_idx
  on public.custom_emission_factors (group_id);

alter table public.custom_emission_factors enable row level security;

create policy "Users can read own custom_emission_factors"
  on public.custom_emission_factors for select
  using (auth.uid() = user_id);

create policy "Users can insert own custom_emission_factors"
  on public.custom_emission_factors for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own custom_emission_factors"
  on public.custom_emission_factors for delete
  using (auth.uid() = user_id);
