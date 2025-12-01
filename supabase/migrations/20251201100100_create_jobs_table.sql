-- Jobs table for the queue
create table public.jobs (
    id bigserial primary key,
    step_id uuid not null references public.migration_steps(id) on delete cascade,
    status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
    payload jsonb not null,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Index for faster worker polling
create index on public.jobs (status);

-- Trigger to automatically update updated_at
create trigger on_jobs_update
  before update on public.jobs
  for each row execute procedure public.handle_updated_at();
