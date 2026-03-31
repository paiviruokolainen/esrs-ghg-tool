-- Requires pgvector extension and emission_factors.embedding vector(1536)
create or replace function public.match_emission_factors(
  query_embedding vector(1536),
  match_count int default 3
)
returns table (
  id text,
  label text,
  value_kg_co2e_per_unit double precision,
  activity_unit text,
  source text,
  year int,
  similarity double precision
)
language sql
stable
as $$
  select
    ef.id,
    ef.label,
    ef.value_kg_co2e_per_unit,
    ef.activity_unit,
    ef.source,
    ef.year,
    1 - (ef.embedding <=> query_embedding) as similarity
  from public.emission_factors ef
  where ef.embedding is not null
  order by ef.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;
