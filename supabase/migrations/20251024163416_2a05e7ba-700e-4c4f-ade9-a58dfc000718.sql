-- Create field_mappings table to store field mapping configurations for migrations
CREATE TABLE public.field_mappings (
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

-- Enable RLS
ALTER TABLE public.field_mappings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view mappings of their migrations"
  ON public.field_mappings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.migrations
      WHERE migrations.id = field_mappings.migration_id
      AND migrations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create mappings for their migrations"
  ON public.field_mappings
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.migrations
      WHERE migrations.id = field_mappings.migration_id
      AND migrations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update mappings of their migrations"
  ON public.field_mappings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.migrations
      WHERE migrations.id = field_mappings.migration_id
      AND migrations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete mappings of their migrations"
  ON public.field_mappings
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.migrations
      WHERE migrations.id = field_mappings.migration_id
      AND migrations.user_id = auth.uid()
    )
  );

-- Trigger for updated_at
CREATE TRIGGER update_field_mappings_updated_at
  BEFORE UPDATE ON public.field_mappings
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();