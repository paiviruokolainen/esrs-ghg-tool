-- Double Materiality Assessment (DMA) — run in Supabase SQL editor
-- Requires: reporting_periods(id), auth.users

create table if not exists public.dma_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reporting_period_id uuid not null references public.reporting_periods (id) on delete cascade,
  company_profile jsonb not null default '{}'::jsonb,
  topic_assessments jsonb not null default '{}'::jsonb,
  dr_list jsonb not null default '[]'::jsonb,
  entity_specific_disclosures text,
  status text not null default 'in_progress',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dma_assessments_status_check check (status in ('in_progress', 'completed'))
);

create unique index if not exists dma_assessments_user_reporting_period_uidx
  on public.dma_assessments (user_id, reporting_period_id);

create index if not exists dma_assessments_reporting_period_id_idx
  on public.dma_assessments (reporting_period_id);

alter table public.dma_assessments enable row level security;

create policy "Users can read own dma_assessments"
  on public.dma_assessments for select
  using (auth.uid() = user_id);

create policy "Users can insert own dma_assessments"
  on public.dma_assessments for insert
  with check (auth.uid() = user_id);

create policy "Users can update own dma_assessments"
  on public.dma_assessments for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own dma_assessments"
  on public.dma_assessments for delete
  using (auth.uid() = user_id);

create or replace function public.set_dma_assessments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists dma_assessments_set_updated_at on public.dma_assessments;
create trigger dma_assessments_set_updated_at
  before update on public.dma_assessments
  for each row
  execute function public.set_dma_assessments_updated_at();
