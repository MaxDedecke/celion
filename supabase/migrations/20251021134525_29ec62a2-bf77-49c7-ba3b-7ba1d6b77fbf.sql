-- Add is_global flag to data_sources
ALTER TABLE public.data_sources
ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT false;

-- Create junction table for data_source to project assignments
CREATE TABLE public.data_source_projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  data_source_id UUID NOT NULL REFERENCES public.data_sources(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_data_source_project UNIQUE (data_source_id, project_id)
);

-- Enable Row Level Security
ALTER TABLE public.data_source_projects ENABLE ROW LEVEL SECURITY;

-- Create policies for data_source_projects
CREATE POLICY "Users can view assignments for their data sources"
ON public.data_source_projects
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.data_sources
    WHERE data_sources.id = data_source_projects.data_source_id
    AND data_sources.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create assignments for their data sources"
ON public.data_source_projects
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.data_sources
    WHERE data_sources.id = data_source_projects.data_source_id
    AND data_sources.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete assignments for their data sources"
ON public.data_source_projects
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.data_sources
    WHERE data_sources.id = data_source_projects.data_source_id
    AND data_sources.user_id = auth.uid()
  )
);

-- Create index for better performance
CREATE INDEX idx_data_source_projects_data_source_id ON public.data_source_projects(data_source_id);
CREATE INDEX idx_data_source_projects_project_id ON public.data_source_projects(project_id);