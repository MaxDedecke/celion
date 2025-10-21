-- Create data_sources table for managing company data sources
CREATE TABLE public.data_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  api_url TEXT,
  api_key TEXT,
  username TEXT,
  password TEXT,
  auth_type TEXT NOT NULL DEFAULT 'api_key',
  additional_config JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.data_sources ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own data sources"
ON public.data_sources
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own data sources"
ON public.data_sources
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own data sources"
ON public.data_sources
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own data sources"
ON public.data_sources
FOR DELETE
USING (auth.uid() = user_id);

-- Create trigger for updated_at
CREATE TRIGGER update_data_sources_updated_at
BEFORE UPDATE ON public.data_sources
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();