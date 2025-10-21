-- Change progress column to support decimal values
ALTER TABLE public.migrations
ALTER COLUMN progress TYPE numeric(5,2);