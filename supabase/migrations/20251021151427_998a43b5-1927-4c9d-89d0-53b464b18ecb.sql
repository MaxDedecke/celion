-- Add meta_model_approved column to migrations table
ALTER TABLE public.migrations 
ADD COLUMN meta_model_approved boolean NOT NULL DEFAULT false;