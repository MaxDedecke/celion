ALTER TABLE public.migrations
ADD COLUMN status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.migrations
ADD COLUMN status_message text;

ALTER TABLE public.migrations
ADD COLUMN result jsonb;
