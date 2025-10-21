-- Create projects table
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_project_name UNIQUE (user_id, name)
);

-- Enable Row Level Security
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Create policies for projects
CREATE POLICY "Users can view their own projects"
ON public.projects
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own projects"
ON public.projects
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own projects"
ON public.projects
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own projects"
ON public.projects
FOR DELETE
USING (auth.uid() = user_id);

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

-- Update RLS policies for migrations to also check project ownership
DROP POLICY IF EXISTS "Users can view their own migrations" ON public.migrations;
DROP POLICY IF EXISTS "Users can create their own migrations" ON public.migrations;
DROP POLICY IF EXISTS "Users can update their own migrations" ON public.migrations;
DROP POLICY IF EXISTS "Users can delete their own migrations" ON public.migrations;

CREATE POLICY "Users can view migrations in their projects"
ON public.migrations
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = migrations.project_id
    AND projects.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create migrations in their projects"
ON public.migrations
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = migrations.project_id
    AND projects.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update migrations in their projects"
ON public.migrations
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = migrations.project_id
    AND projects.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete migrations in their projects"
ON public.migrations
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = migrations.project_id
    AND projects.user_id = auth.uid()
  )
);