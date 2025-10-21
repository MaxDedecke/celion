-- Create migrations table
CREATE TABLE public.migrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  source_system text NOT NULL,
  target_system text NOT NULL,
  in_connector text NOT NULL,
  in_connector_detail text NOT NULL,
  out_connector text NOT NULL,
  out_connector_detail text NOT NULL,
  objects_transferred text NOT NULL DEFAULT '0/0',
  mapped_objects text NOT NULL DEFAULT '0/0',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create activities table
CREATE TABLE public.migration_activities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('success', 'info', 'error', 'warning')),
  title text NOT NULL,
  timestamp text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_activities ENABLE ROW LEVEL SECURITY;

-- RLS Policies for migrations table
CREATE POLICY "Users can view their own migrations" 
ON public.migrations 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own migrations" 
ON public.migrations 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own migrations" 
ON public.migrations 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own migrations" 
ON public.migrations 
FOR DELETE 
USING (auth.uid() = user_id);

-- RLS Policies for activities table
CREATE POLICY "Users can view activities of their migrations" 
ON public.migration_activities 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.migrations 
    WHERE migrations.id = migration_activities.migration_id 
    AND migrations.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create activities for their migrations" 
ON public.migration_activities 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.migrations 
    WHERE migrations.id = migration_activities.migration_id 
    AND migrations.user_id = auth.uid()
  )
);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for migrations table
CREATE TRIGGER set_migrations_updated_at
BEFORE UPDATE ON public.migrations
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Create indexes for better performance
CREATE INDEX idx_migrations_user_id ON public.migrations(user_id);
CREATE INDEX idx_migration_activities_migration_id ON public.migration_activities(migration_id);