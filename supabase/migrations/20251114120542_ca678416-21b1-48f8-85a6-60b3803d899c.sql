-- Add source_url and target_url columns to migrations table
ALTER TABLE public.migrations 
ADD COLUMN source_url TEXT,
ADD COLUMN target_url TEXT;