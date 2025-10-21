-- Drop the existing check constraint
ALTER TABLE public.migration_activities DROP CONSTRAINT IF EXISTS migration_activities_type_check;

-- Add new check constraint that includes 'system' type
ALTER TABLE public.migration_activities 
ADD CONSTRAINT migration_activities_type_check 
CHECK (type IN ('success', 'error', 'info', 'warning', 'system'));