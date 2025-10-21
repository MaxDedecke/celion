-- Add auth_type column to connectors table
ALTER TABLE public.connectors 
ADD COLUMN IF NOT EXISTS auth_type text NOT NULL DEFAULT 'api_key';

-- Add comment to explain auth_type values
COMMENT ON COLUMN public.connectors.auth_type IS 'Authentication type: api_key, basic, oauth2, custom';

-- Update existing rows to have proper auth_type based on existing data
UPDATE public.connectors 
SET auth_type = CASE 
  WHEN api_key IS NOT NULL AND api_key != '' THEN 'api_key'
  WHEN username IS NOT NULL AND username != '' THEN 'basic'
  ELSE 'api_key'
END;