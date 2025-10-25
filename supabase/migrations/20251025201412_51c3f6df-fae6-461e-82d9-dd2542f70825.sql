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