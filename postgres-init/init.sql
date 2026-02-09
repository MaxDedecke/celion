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
  scope_config jsonb DEFAULT '{}'::jsonb,
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
  email TEXT,
  auth_type TEXT NOT NULL DEFAULT 'api_key',
  additional_config JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

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


-- Add is_global flag to data_sources
ALTER TABLE public.data_sources
ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT false;

-- Ensure email column exists for data_sources
ALTER TABLE public.data_sources
ADD COLUMN IF NOT EXISTS email TEXT;

-- Create junction table for data_source to project assignments
CREATE TABLE IF NOT EXISTS public.data_source_projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  data_source_id UUID NOT NULL REFERENCES public.data_sources(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_data_source_project UNIQUE (data_source_id, project_id)
);

-- Create index for better performance
CREATE INDEX idx_data_source_projects_data_source_id ON public.data_source_projects(data_source_id);
CREATE INDEX idx_data_source_projects_project_id ON public.data_source_projects(project_id);

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


-- -------------------------
-- Project membership for collaboration
-- -------------------------

-- Create project_members junction table for collaboration
CREATE TABLE IF NOT EXISTS public.project_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON public.project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON public.project_members(project_id);

-- -------------------------
-- Migration chat feature
-- -------------------------

-- Create migration_chat_messages table
CREATE TABLE IF NOT EXISTS public.migration_chat_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  step_number integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_migration_chat_messages_migration_id ON public.migration_chat_messages(migration_id);

-- Add step tracking to migrations table
ALTER TABLE public.migrations
ADD COLUMN IF NOT EXISTS current_step integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS step_status text NOT NULL DEFAULT 'idle' CHECK (step_status IN ('idle', 'pending', 'running', 'completed', 'failed'));

-- -------------------------
-- Structured Agent Results
-- -------------------------

-- Step 1: System Detection Results
CREATE TABLE IF NOT EXISTS public.step_1_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
  system_mode text NOT NULL CHECK (system_mode IN ('source', 'target')),
  detected_system text,
  confidence_score numeric,
  api_type text,
  api_subtype text,
  recommended_base_url text,
  raw_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(migration_id, system_mode)
);

-- Step 2: Authentication Results
CREATE TABLE IF NOT EXISTS public.step_2_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
  system_mode text NOT NULL CHECK (system_mode IN ('source', 'target')),
  is_authenticated boolean NOT NULL DEFAULT false,
  auth_type text,
  error_message text,
  raw_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(migration_id, system_mode)
);

-- Step 3: Capability Discovery Results (Inventory)
CREATE TABLE IF NOT EXISTS public.step_3_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
  entity_name text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  complexity text, -- 'low', 'medium', 'high'
  error_message text,
  raw_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(migration_id, entity_name)
);

-- Add complexity score to migrations table
ALTER TABLE public.migrations
ADD COLUMN IF NOT EXISTS complexity_score integer DEFAULT 0;

-- Step 4: Target Discovery Results
CREATE TABLE IF NOT EXISTS public.step_4_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
  target_scope_id text,
  target_scope_name text,
  target_status text,
  writable_entities text[],
  missing_permissions text[],
  summary text,
  raw_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(migration_id)
);

-- Step 5: Model Mapping Results
CREATE TABLE IF NOT EXISTS public.step_5_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
  summary text,
  raw_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(migration_id)
);