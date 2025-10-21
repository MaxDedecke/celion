-- Create connectors table
CREATE TABLE public.connectors (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
  connector_type text NOT NULL CHECK (connector_type IN ('in', 'out')),
  api_url text,
  api_key text,
  username text,
  password text,
  endpoint text,
  additional_config jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(migration_id, connector_type)
);

-- Enable Row Level Security
ALTER TABLE public.connectors ENABLE ROW LEVEL SECURITY;

-- RLS Policies for connectors table
CREATE POLICY "Users can view connectors of their migrations" 
ON public.connectors 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.migrations 
    WHERE migrations.id = connectors.migration_id 
    AND migrations.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create connectors for their migrations" 
ON public.connectors 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.migrations 
    WHERE migrations.id = connectors.migration_id 
    AND migrations.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update connectors of their migrations" 
ON public.connectors 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM public.migrations 
    WHERE migrations.id = connectors.migration_id 
    AND migrations.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete connectors of their migrations" 
ON public.connectors 
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM public.migrations 
    WHERE migrations.id = connectors.migration_id 
    AND migrations.user_id = auth.uid()
  )
);

-- Trigger for connectors table
CREATE TRIGGER set_connectors_updated_at
BEFORE UPDATE ON public.connectors
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Create index for better performance
CREATE INDEX idx_connectors_migration_id ON public.connectors(migration_id);