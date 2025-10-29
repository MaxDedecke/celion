-- Add notes column to migrations table for storing migration prompts and annotations
ALTER TABLE public.migrations
ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
