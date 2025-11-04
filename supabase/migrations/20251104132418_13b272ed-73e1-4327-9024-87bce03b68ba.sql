-- Add missing columns to migrations table for workflow management

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