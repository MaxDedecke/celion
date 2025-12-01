-- Function to update the updated_at column
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Migration steps table
create table public.migration_steps (
    id uuid primary key default gen_random_uuid(),
    migration_id uuid not null references public.migrations(id) on delete cascade,
    name text not null,
    status text not null default 'pending',
    status_message text,
    result jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Index for faster lookups
create index on public.migration_steps (migration_id);

-- Trigger to automatically update updated_at
create trigger on_migration_steps_update
  before update on public.migration_steps
  for each row execute procedure public.handle_updated_at();

-- Add a "steps" column to the migrations table to store the order of steps
alter table public.migrations
add column if not exists steps jsonb;
