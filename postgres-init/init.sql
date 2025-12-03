-- This is a concatenated and modified initialization script from the supabase/migrations directory.
-- have been removed or commented out to ensure compatibility with a standard PostgreSQL database.
-- It is assumed that security will be handled at the application/API level.

-- Ensure UUID generation helpers are available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Basic user store for application logins
CREATE TABLE IF NOT EXISTS public.users (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password text NOT NULL,
  full_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Seed a demo user for local development
INSERT INTO public.users (email, password, full_name)
VALUES ('demo@celion.local', 'celion', 'Celion Demo User')
ON CONFLICT (email) DO NOTHING;

-- Grant necessary privileges to the application role
GRANT USAGE ON SCHEMA public TO celion;
GRANT ALL ON ALL TABLES IN SCHEMA public TO celion;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO celion;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO celion;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO celion;

-- Create migrations table
CREATE TABLE IF NOT EXISTS public.migrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  source_system text NOT NULL,
  target_system text NOT NULL,
  in_connector text NOT NULL,
  in_connector_detail text NOT NULL,
  out_connector text NOT NULL,
  out_connector_detail text NOT NULL,
  objects_transferred text NOT NULL DEFAULT '0/0',
  mapped_objects text NOT NULL DEFAULT '0/0',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create activities table
CREATE TABLE IF NOT EXISTS public.migration_activities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('success', 'info', 'error', 'warning')),
  title text NOT NULL,
  timestamp text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- ALTER TABLE public.migrations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.migration_activities ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Users can view their own migrations" 
-- ON public.migrations 
-- FOR SELECT 
-- USING (auth.uid() = user_id);

-- CREATE POLICY "Users can create their own migrations" 
-- ON public.migrations 
-- FOR INSERT 
-- WITH CHECK (auth.uid() = user_id);

-- CREATE POLICY "Users can update their own migrations" 
-- ON public.migrations 
-- FOR UPDATE 
-- USING (auth.uid() = user_id);

-- CREATE POLICY "Users can delete their own migrations" 
-- ON public.migrations 
-- FOR DELETE 
-- USING (auth.uid() = user_id);

-- CREATE POLICY "Users can view activities of their migrations" 
-- ON public.migration_activities 
-- FOR SELECT 
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.migrations 
--     WHERE migrations.id = migration_activities.migration_id 
--     AND migrations.user_id = auth.uid()
--   )
-- );

-- CREATE POLICY "Users can create activities for their migrations" 
-- ON public.migration_activities 
-- FOR INSERT 
-- WITH CHECK (
--   EXISTS (
--     SELECT 1 FROM public.migrations 
--     WHERE migrations.id = migration_activities.migration_id 
--     AND migrations.user_id = auth.uid()
--   )
-- );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for migrations table
CREATE TRIGGER set_migrations_updated_at
BEFORE UPDATE ON public.migrations
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Create indexes for better performance
CREATE INDEX idx_migrations_user_id ON public.migrations(user_id);
CREATE INDEX idx_migration_activities_migration_id ON public.migration_activities(migration_id);


-- Fix function search path security issue
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- Create connectors table
CREATE TABLE IF NOT EXISTS public.connectors (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
  connector_type text NOT NULL CHECK (connector_type IN ('in', 'out')),
  api_url text,
  api_key text,
  username text,
  password text,
  endpoint text,
  additional_config jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(migration_id, connector_type)
);

-- ALTER TABLE public.connectors ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Users can view connectors of their migrations" 
-- ON public.connectors 
-- FOR SELECT 
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.migrations 
--     WHERE migrations.id = connectors.migration_id 
--     AND migrations.user_id = auth.uid()
--   )
-- );

-- CREATE POLICY "Users can create connectors for their migrations" 
-- ON public.connectors 
-- FOR INSERT 
-- WITH CHECK (
--   EXISTS (
--     SELECT 1 FROM public.migrations 
--     WHERE migrations.id = connectors.migration_id 
--     AND migrations.user_id = auth.uid()
--   )
-- );

-- CREATE POLICY "Users can update connectors of their migrations" 
-- ON public.connectors 
-- FOR UPDATE 
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.migrations 
--     WHERE migrations.id = connectors.migration_id 
--     AND migrations.user_id = auth.uid()
--   )
-- );

-- CREATE POLICY "Users can delete connectors of their migrations" 
-- ON public.connectors 
-- FOR DELETE 
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.migrations 
--     WHERE migrations.id = connectors.migration_id 
--     AND migrations.user_id = auth.uid()
--   )
-- );

-- Trigger for connectors table
CREATE TRIGGER set_connectors_updated_at
BEFORE UPDATE ON public.connectors
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Create index for better performance
CREATE INDEX idx_connectors_migration_id ON public.connectors(migration_id);


-- Add auth_type column to connectors table
ALTER TABLE public.connectors 
ADD COLUMN IF NOT EXISTS auth_type text NOT NULL DEFAULT 'api_key';

-- Add comment to explain auth_type values
COMMENT ON COLUMN public.connectors.auth_type IS 'Authentication type: api_key, basic, oauth2, custom';

-- Update existing rows to have proper auth_type based on existing data
UPDATE public.connectors 
SET auth_type = CASE 
  WHEN api_key IS NOT NULL AND api_key != '' THEN 'api_key'
  WHEN username IS NOT NULL AND username != '' THEN 'basic'
  ELSE 'api_key'
END;


-- Drop the existing check constraint
ALTER TABLE public.migration_activities DROP CONSTRAINT IF EXISTS migration_activities_type_check;

-- Add new check constraint that includes 'system' type
ALTER TABLE public.migration_activities 
ADD CONSTRAINT migration_activities_type_check 
CHECK (type IN ('success', 'error', 'info', 'warning', 'system'));


-- Create data_sources table for managing company data sources
CREATE TABLE IF NOT EXISTS public.data_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  api_url TEXT,
  api_key TEXT,
  username TEXT,
  password TEXT,
  auth_type TEXT NOT NULL DEFAULT 'api_key',
  additional_config JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ALTER TABLE public.data_sources ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Users can view their own data sources"
-- ON public.data_sources
-- FOR SELECT
-- USING (auth.uid() = user_id);

-- CREATE POLICY "Users can create their own data sources"
-- ON public.data_sources
-- FOR INSERT
-- WITH CHECK (auth.uid() = user_id);

-- CREATE POLICY "Users can update their own data sources"
-- ON public.data_sources
-- FOR UPDATE
-- USING (auth.uid() = user_id);

-- CREATE POLICY "Users can delete their own data sources"
-- ON public.data_sources
-- FOR DELETE
-- USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER update_data_sources_updated_at
BEFORE UPDATE ON public.data_sources
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();


-- Add is_tested column to connectors table
ALTER TABLE public.connectors
ADD COLUMN is_tested boolean NOT NULL DEFAULT false;


-- Change progress column to support decimal values
ALTER TABLE public.migrations
ALTER COLUMN progress TYPE numeric(5,2);


-- Create projects table
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_project_name UNIQUE (user_id, name)
);

-- ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Users can view their own projects"
-- ON public.projects
-- FOR SELECT
-- USING (auth.uid() = user_id);

-- CREATE POLICY "Users can create their own projects"
-- ON public.projects
-- FOR INSERT
-- WITH CHECK (auth.uid() = user_id);

-- CREATE POLICY "Users can update their own projects"
-- ON public.projects
-- FOR UPDATE
-- USING (auth.uid() = user_id);

-- CREATE POLICY "Users can delete their own projects"
-- ON public.projects
-- FOR DELETE
-- USING (auth.uid() = user_id);

-- Add trigger for automatic timestamp updates
CREATE TRIGGER update_projects_updated_at
BEFORE UPDATE ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Add project_id to migrations table
ALTER TABLE public.migrations
ADD COLUMN project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE;

-- Create index for better performance
CREATE INDEX idx_migrations_project_id ON public.migrations(project_id);

-- DROP POLICY IF EXISTS "Users can view their own migrations" ON public.migrations;
-- DROP POLICY IF EXISTS "Users can create their own migrations" ON public.migrations;
-- DROP POLICY IF EXISTS "Users can update their own migrations" ON public.migrations;
-- DROP POLICY IF EXISTS "Users can delete their own migrations" ON public.migrations;

-- CREATE POLICY "Users can view migrations in their projects"
-- ON public.migrations
-- FOR SELECT
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.projects
--     WHERE projects.id = migrations.project_id
--     AND projects.user_id = auth.uid()
--   )
-- );

-- CREATE POLICY "Users can create migrations in their projects"
-- ON public.migrations
-- FOR INSERT
-- WITH CHECK (
--   EXISTS (
--     SELECT 1 FROM public.projects
--     WHERE projects.id = migrations.project_id
--     AND projects.user_id = auth.uid()
--   )
-- );

-- CREATE POLICY "Users can update migrations in their projects"
-- ON public.migrations
-- FOR UPDATE
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.projects
--     WHERE projects.id = migrations.project_id
--     AND projects.user_id = auth.uid()
--   )
-- );

-- CREATE POLICY "Users can delete migrations in their projects"
-- ON public.migrations
-- FOR DELETE
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.projects
--     WHERE projects.id = migrations.project_id
--     AND projects.user_id = auth.uid()
--   )
-- );


-- Add is_global flag to data_sources
ALTER TABLE public.data_sources
ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT false;

-- Create junction table for data_source to project assignments
CREATE TABLE IF NOT EXISTS public.data_source_projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  data_source_id UUID NOT NULL REFERENCES public.data_sources(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_data_source_project UNIQUE (data_source_id, project_id)
);

-- ALTER TABLE public.data_source_projects ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Users can view assignments for their data sources"
-- ON public.data_source_projects
-- FOR SELECT
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.data_sources
--     WHERE data_sources.id = data_source_projects.data_source_id
--     AND data_sources.user_id = auth.uid()
--   )
-- );

-- CREATE POLICY "Users can create assignments for their data sources"
-- ON public.data_source_projects
-- FOR INSERT
-- WITH CHECK (
--   EXISTS (
--     SELECT 1 FROM public.data_sources
--     WHERE data_sources.id = data_source_projects.data_source_id
--     AND data_sources.user_id = auth.uid()
--   )
-- );

-- CREATE POLICY "Users can delete assignments for their data sources"
-- ON public.data_source_projects
-- FOR DELETE
-- USING (
--   EXISTS (
--     SELECT 1 FROM public.data_sources
--     WHERE data_sources.id = data_source_projects.data_source_id
--     AND data_sources.user_id = auth.uid()
--   )
-- );

-- Create index for better performance
CREATE INDEX idx_data_source_projects_data_source_id ON public.data_source_projects(data_source_id);
CREATE INDEX idx_data_source_projects_project_id ON public.data_source_projects(project_id);


-- DROP POLICY IF EXISTS "Users can create migrations in their projects" ON migrations;
-- DROP POLICY IF EXISTS "Users can view migrations in their projects" ON migrations;
-- DROP POLICY IF EXISTS "Users can update migrations in their projects" ON migrations;
-- DROP POLICY IF EXISTS "Users can delete migrations in their projects" ON migrations;

-- CREATE POLICY "Users can create their own migrations"
-- ON migrations FOR INSERT
-- WITH CHECK (
--   auth.uid() = user_id AND
--   (project_id IS NULL OR EXISTS (
--     SELECT 1 FROM projects 
--     WHERE projects.id = migrations.project_id 
--     AND projects.user_id = auth.uid()
--   ))
-- );

-- CREATE POLICY "Users can view their own migrations"
-- ON migrations FOR SELECT
-- USING (
--   auth.uid() = user_id
-- );

-- CREATE POLICY "Users can update their own migrations"
-- ON migrations FOR UPDATE
-- USING (auth.uid() = user_id);

-- CREATE POLICY "Users can delete their own migrations"
-- ON migrations FOR DELETE
-- USING (auth.uid() = user_id);


-- Add meta_model_approved column to migrations table
ALTER TABLE public.migrations 
ADD COLUMN meta_model_approved boolean NOT NULL DEFAULT false;


-- Create field_mappings table to store field mapping configurations for migrations
CREATE TABLE IF NOT EXISTS public.field_mappings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  migration_id UUID NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
  target_field_id TEXT NOT NULL,
  source_field_id TEXT NOT NULL,
  mapping_type TEXT NOT NULL DEFAULT 'direct' CHECK (mapping_type IN ('direct', 'collection')),
  collection_item_field_id TEXT,
  join_with TEXT DEFAULT ', ',
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ALTER TABLE public.field_mappings ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Users can view mappings of their migrations"
--   ON public.field_mappings
--   FOR SELECT
--   USING (
--     EXISTS (
--       SELECT 1 FROM public.migrations
--       WHERE migrations.id = field_mappings.migration_id
--       AND migrations.user_id = auth.uid()
--     )
--   );

-- CREATE POLICY "Users can create mappings for their migrations"
--   ON public.field_mappings
--   FOR INSERT
--   WITH CHECK (
--     EXISTS (
--       SELECT 1 FROM public.migrations
--       WHERE migrations.id = field_mappings.migration_id
--       AND migrations.user_id = auth.uid()
--     )
--   );

-- CREATE POLICY "Users can update mappings of their migrations"
--   ON public.field_mappings
--   FOR UPDATE
--   USING (
--     EXISTS (
--       SELECT 1 FROM public.migrations
--       WHERE migrations.id = field_mappings.migration_id
--       AND migrations.user_id = auth.uid()
--     )
--   );

-- CREATE POLICY "Users can delete mappings of their migrations"
--   ON public.field_mappings
--   FOR DELETE
--   USING (
--     EXISTS (
--       SELECT 1 FROM public.migrations
--       WHERE migrations.id = field_mappings.migration_id
--       AND migrations.user_id = auth.uid()
--     )
--   );

-- Trigger for updated_at
CREATE TRIGGER update_field_mappings_updated_at
  BEFORE UPDATE ON public.field_mappings
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();


-- Add source_object_type and target_object_type to field_mappings table
-- to make mappings object-specific

ALTER TABLE public.field_mappings
ADD COLUMN source_object_type text,
ADD COLUMN target_object_type text;

-- Update existing rows to have empty strings (will be populated by the application)
UPDATE public.field_mappings
SET source_object_type = '',
    target_object_type = '';

-- Make these columns NOT NULL after populating existing data
ALTER TABLE public.field_mappings
ALTER COLUMN source_object_type SET NOT NULL,
ALTER COLUMN target_object_type SET NOT NULL;


-- Create pipelines table to support multiple API connections per migration
CREATE TABLE IF NOT EXISTS public.pipelines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  migration_id UUID NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  source_data_source_id UUID REFERENCES public.data_sources(id) ON DELETE SET NULL,
  target_data_source_id UUID REFERENCES public.data_sources(id) ON DELETE SET NULL,
  source_system TEXT NOT NULL,
  target_system TEXT NOT NULL,
  execution_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  progress NUMERIC NOT NULL DEFAULT 0,
  objects_transferred TEXT NOT NULL DEFAULT '0/0',
  mapped_objects TEXT NOT NULL DEFAULT '0/0',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Users can view pipelines of their migrations"
-- ON public.pipelines FOR SELECT
-- USING (EXISTS (
--   SELECT 1 FROM public.migrations
--   WHERE migrations.id = pipelines.migration_id AND migrations.user_id = auth.uid()
-- ));

-- CREATE POLICY "Users can create pipelines for their migrations"
-- ON public.pipelines FOR INSERT
-- WITH CHECK (EXISTS (
--   SELECT 1 FROM public.migrations
--   WHERE migrations.id = pipelines.migration_id AND migrations.user_id = auth.uid()
-- ));

-- CREATE POLICY "Users can update pipelines of their migrations"
-- ON public.pipelines FOR UPDATE
-- USING (EXISTS (
--   SELECT 1 FROM public.migrations
--   WHERE migrations.id = pipelines.migration_id AND migrations.user_id = auth.uid()
-- ));

-- CREATE POLICY "Users can delete pipelines of their migrations"
-- ON public.pipelines FOR DELETE
-- USING (EXISTS (
--   SELECT 1 FROM public.migrations
--   WHERE migrations.id = pipelines.migration_id AND migrations.user_id = auth.uid()
-- ));

-- Add trigger for updated_at
CREATE TRIGGER update_pipelines_updated_at
BEFORE UPDATE ON public.pipelines
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Add pipeline_id to field_mappings
ALTER TABLE public.field_mappings ADD COLUMN pipeline_id UUID REFERENCES public.pipelines(id) ON DELETE CASCADE;

-- Create index for faster queries
CREATE INDEX idx_pipelines_migration_id ON public.pipelines(migration_id);
CREATE INDEX idx_field_mappings_pipeline_id ON public.field_mappings(pipeline_id);

-- Migrate existing data: Create a default pipeline for each migration
INSERT INTO public.pipelines (migration_id, name, source_system, target_system, execution_order)
SELECT 
  id as migration_id,
  'Standard Pipeline' as name,
  source_system,
  target_system,
  0 as execution_order
FROM public.migrations;

-- Update field_mappings to reference the new pipelines
UPDATE public.field_mappings fm
SET pipeline_id = (
  SELECT p.id 
  FROM public.pipelines p 
  WHERE p.migration_id = (SELECT migration_id FROM public.field_mappings WHERE id = fm.id)
  LIMIT 1
);

-- Make pipeline_id NOT NULL after migration
ALTER TABLE public.field_mappings ALTER COLUMN pipeline_id SET NOT NULL;

-- Drop the now-redundant migration_id column
ALTER TABLE public.field_mappings DROP COLUMN migration_id;

-- CREATE POLICY "Users can view mappings of their pipelines"
-- ON public.field_mappings FOR SELECT
-- USING (EXISTS (
--   SELECT 1 FROM public.pipelines p
--   JOIN public.migrations m ON m.id = p.migration_id
--   WHERE p.id = field_mappings.pipeline_id AND m.user_id = auth.uid()
-- ));

-- CREATE POLICY "Users can create mappings for their pipelines"
-- ON public.field_mappings FOR INSERT
-- WITH CHECK (EXISTS (
--   SELECT 1 FROM public.pipelines p
--   JOIN public.migrations m ON m.id = p.migration_id
--   WHERE p.id = field_mappings.pipeline_id AND m.user_id = auth.uid()
-- ));

-- CREATE POLICY "Users can update mappings of their pipelines"
-- ON public.field_mappings FOR UPDATE
-- USING (EXISTS (
--   SELECT 1 FROM public.pipelines p
--   JOIN public.migrations m ON m.id = p.migration_id
--   WHERE p.id = field_mappings.pipeline_id AND m.user_id = auth.uid()
-- ));

-- CREATE POLICY "Users can delete mappings of their pipelines"
-- ON public.field_mappings FOR DELETE
-- USING (EXISTS (
--   SELECT 1 FROM public.pipelines p
--   JOIN public.migrations m ON m.id = p.migration_id
--   WHERE p.id = field_mappings.pipeline_id AND m.user_id = auth.uid()
-- ));


-- Add workflow_type column to pipelines table
ALTER TABLE pipelines 
ADD COLUMN workflow_type TEXT NOT NULL DEFAULT 'manual' CHECK (workflow_type IN ('manual', 'agent'));

-- Create agent_workflow_states table to persist agent workflow data
CREATE TABLE IF NOT EXISTS agent_workflow_states (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  briefing TEXT NOT NULL DEFAULT '',
  plan JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_steps JSONB NOT NULL DEFAULT '{}'::jsonb,
  logs JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_running BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(pipeline_id)
);

-- ALTER TABLE agent_workflow_states ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Users can view agent states of their pipelines"
-- ON agent_workflow_states
-- FOR SELECT
-- USING (
--   EXISTS (
--     SELECT 1 FROM pipelines p
--     JOIN migrations m ON m.id = p.migration_id
--     WHERE p.id = agent_workflow_states.pipeline_id
--     AND m.user_id = auth.uid()
--   )
-- );

-- CREATE POLICY "Users can create agent states for their pipelines"
-- ON agent_workflow_states
-- FOR INSERT
-- WITH CHECK (
--   EXISTS (
--     SELECT 1 FROM pipelines p
--     JOIN migrations m ON m.id = p.migration_id
--     WHERE p.id = agent_workflow_states.pipeline_id
--     AND m.user_id = auth.uid()
--   )
-- );

-- CREATE POLICY "Users can update agent states of their pipelines"
-- ON agent_workflow_states
-- FOR UPDATE
-- USING (
--   EXISTS (
--     SELECT 1 FROM pipelines p
--     JOIN migrations m ON m.id = p.migration_id
--     WHERE p.id = agent_workflow_states.pipeline_id
--     AND m.user_id = auth.uid()
--   )
-- );

-- CREATE POLICY "Users can delete agent states of their pipelines"
-- ON agent_workflow_states
-- FOR DELETE
-- USING (
--   EXISTS (
--     SELECT 1 FROM pipelines p
--     JOIN migrations m ON m.id = p.migration_id
--     WHERE p.id = agent_workflow_states.pipeline_id
--     AND m.user_id = auth.uid()
--   )
-- );

-- Add trigger for updated_at on agent_workflow_states
CREATE TRIGGER update_agent_workflow_states_updated_at
BEFORE UPDATE ON agent_workflow_states
FOR EACH ROW
EXECUTE FUNCTION handle_updated_at();


-- Add notes column to migrations table for storing migration prompts and annotations
ALTER TABLE public.migrations
ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';


-- Add source_url and target_url columns to migrations table
ALTER TABLE public.migrations 
ADD COLUMN source_url TEXT,
ADD COLUMN target_url TEXT;


ALTER TABLE public.migrations
ADD COLUMN status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.migrations
ADD COLUMN status_message text;

ALTER TABLE public.migrations
ADD COLUMN result jsonb;


-- Add status column with default 'not_started'
ALTER TABLE public.migrations 
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'not_started';

-- Add workflow_state column to store workflow board state as JSON
ALTER TABLE public.migrations 
ADD COLUMN IF NOT EXISTS workflow_state jsonb DEFAULT NULL;

-- Add notes column for migration notes
ALTER TABLE public.migrations 
ADD COLUMN IF NOT EXISTS notes text DEFAULT NULL;

-- Add a check constraint to ensure valid status values
ALTER TABLE public.migrations 
ADD CONSTRAINT migrations_status_check 
CHECK (status IN ('not_started', 'running', 'paused', 'completed'));


-- Function to update the updated_at column
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- -------------------------
-- Background job orchestration tables
-- -------------------------

-- Allow a dedicated step table that maps UI workflow steps to persisted executions
CREATE TABLE IF NOT EXISTS public.migration_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
  workflow_step_id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  status_message text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (migration_id, workflow_step_id)
);

CREATE INDEX IF NOT EXISTS idx_migration_steps_migration_id ON public.migration_steps(migration_id);
CREATE TRIGGER update_migration_steps_updated_at
BEFORE UPDATE ON public.migration_steps
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Jobs table for worker queue processing
CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  step_id uuid NOT NULL REFERENCES public.migration_steps(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  last_error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_step_id ON public.jobs(step_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.jobs(status);
CREATE TRIGGER update_jobs_updated_at
BEFORE UPDATE ON public.jobs
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Broaden allowed migration statuses to reflect background processing
ALTER TABLE public.migrations DROP CONSTRAINT IF EXISTS migrations_status_check;
ALTER TABLE public.migrations
ADD CONSTRAINT migrations_status_check
CHECK (status IN ('not_started', 'running', 'paused', 'completed', 'processing'));


-- Add a "steps" column to the migrations table to store the order of steps
alter table public.migrations
add column if not exists steps jsonb;