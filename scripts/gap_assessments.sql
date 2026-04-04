-- Gap Assessment — run in Supabase SQL editor
-- Requires: reporting_periods(id), auth.users

create table if not exists public.gap_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reporting_period_id uuid not null references public.reporting_periods (id) on delete cascade,
  results jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gap_assessments_user_reporting_period_uidx unique (user_id, reporting_period_id)
);

create index if not exists gap_assessments_reporting_period_id_idx
  on public.gap_assessments (reporting_period_id);

alter table public.gap_assessments enable row level security;

create policy "Users can read own gap_assessments"
  on public.gap_assessments for select
  using (auth.uid() = user_id);

create policy "Users can insert own gap_assessments"
  on public.gap_assessments for insert
  with check (auth.uid() = user_id);

create policy "Users can update own gap_assessments"
  on public.gap_assessments for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own gap_assessments"
  on public.gap_assessments for delete
  using (auth.uid() = user_id);

create or replace function public.set_gap_assessments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists gap_assessments_set_updated_at on public.gap_assessments;
create trigger gap_assessments_set_updated_at
  before update on public.gap_assessments
  for each row
  execute function public.set_gap_assessments_updated_at();
