-- Add is_tested column to connectors table
ALTER TABLE public.connectors
ADD COLUMN is_tested boolean NOT NULL DEFAULT false;