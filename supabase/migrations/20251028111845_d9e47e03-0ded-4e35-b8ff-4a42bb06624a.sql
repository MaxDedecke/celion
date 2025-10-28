-- Create pipelines table to support multiple API connections per migration
CREATE TABLE public.pipelines (
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

-- Enable RLS for pipelines
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

-- Create policies for pipelines
CREATE POLICY "Users can view pipelines of their migrations"
ON public.pipelines FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.migrations
  WHERE migrations.id = pipelines.migration_id AND migrations.user_id = auth.uid()
));

CREATE POLICY "Users can create pipelines for their migrations"
ON public.pipelines FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.migrations
  WHERE migrations.id = pipelines.migration_id AND migrations.user_id = auth.uid()
));

CREATE POLICY "Users can update pipelines of their migrations"
ON public.pipelines FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.migrations
  WHERE migrations.id = pipelines.migration_id AND migrations.user_id = auth.uid()
));

CREATE POLICY "Users can delete pipelines of their migrations"
ON public.pipelines FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.migrations
  WHERE migrations.id = pipelines.migration_id AND migrations.user_id = auth.uid()
));

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
  WHERE p.migration_id = fm.migration_id 
  LIMIT 1
);

-- Make pipeline_id NOT NULL after migration
ALTER TABLE public.field_mappings ALTER COLUMN pipeline_id SET NOT NULL;

-- Drop old RLS policies that depend on migration_id
DROP POLICY IF EXISTS "Users can view mappings of their migrations" ON public.field_mappings;
DROP POLICY IF EXISTS "Users can create mappings for their migrations" ON public.field_mappings;
DROP POLICY IF EXISTS "Users can update mappings of their migrations" ON public.field_mappings;
DROP POLICY IF EXISTS "Users can delete mappings of their migrations" ON public.field_mappings;

-- Drop migration_id column
ALTER TABLE public.field_mappings DROP COLUMN migration_id;

-- Create new RLS policies based on pipeline_id
CREATE POLICY "Users can view mappings of their pipelines"
ON public.field_mappings FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.pipelines p
  JOIN public.migrations m ON m.id = p.migration_id
  WHERE p.id = field_mappings.pipeline_id AND m.user_id = auth.uid()
));

CREATE POLICY "Users can create mappings for their pipelines"
ON public.field_mappings FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.pipelines p
  JOIN public.migrations m ON m.id = p.migration_id
  WHERE p.id = field_mappings.pipeline_id AND m.user_id = auth.uid()
));

CREATE POLICY "Users can update mappings of their pipelines"
ON public.field_mappings FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.pipelines p
  JOIN public.migrations m ON m.id = p.migration_id
  WHERE p.id = field_mappings.pipeline_id AND m.user_id = auth.uid()
));

CREATE POLICY "Users can delete mappings of their pipelines"
ON public.field_mappings FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.pipelines p
  JOIN public.migrations m ON m.id = p.migration_id
  WHERE p.id = field_mappings.pipeline_id AND m.user_id = auth.uid()
));