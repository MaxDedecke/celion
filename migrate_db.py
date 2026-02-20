import psycopg
import os
import sys

def migrate():
    try:
        conn = psycopg.connect(
            host=os.environ.get("POSTGRES_HOST", "localhost"),
            port=os.environ.get("POSTGRES_PORT", "5432"),
            dbname=os.environ.get("POSTGRES_DB", "celion"),
            user=os.environ.get("POSTGRES_USER", "celion"),
            password=os.environ.get("POSTGRES_PASSWORD", "celion"),
        )
        cur = conn.cursor()
        
        print("Creating mapping_chat_messages table...")
        cur.execute("""
        CREATE TABLE IF NOT EXISTS public.mapping_chat_messages (
          id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
          migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
          role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content text NOT NULL,
          created_at timestamp with time zone NOT NULL DEFAULT now()
        );
        """)
        
        print("Creating mapping_rules table...")
        cur.execute("""
        CREATE TABLE IF NOT EXISTS public.mapping_rules (
          id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
          migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
          source_system text NOT NULL,
          source_object text NOT NULL,
          source_property text,
          target_system text NOT NULL,
          target_object text NOT NULL,
          target_property text,
          note text,
          rule_type text NOT NULL,
          enhancements jsonb DEFAULT '[]'::jsonb,
          created_at timestamp with time zone NOT NULL DEFAULT now()
        );
        """)

        print("Creating step_6_results and step_7_results tables...")
        cur.execute("""
        CREATE TABLE IF NOT EXISTS public.step_6_results (
          id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
          migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
          summary text,
          raw_json jsonb DEFAULT '{}'::jsonb,
          created_at timestamp with time zone NOT NULL DEFAULT now(),
          updated_at timestamp with time zone DEFAULT now(),
          UNIQUE(migration_id)
        );
        """)

        cur.execute("""
        CREATE TABLE IF NOT EXISTS public.step_7_results (
          id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
          migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
          summary text,
          raw_json jsonb DEFAULT '{}'::jsonb,
          created_at timestamp with time zone NOT NULL DEFAULT now(),
          updated_at timestamp with time zone DEFAULT now(),
          UNIQUE(migration_id)
        );
        """)

        cur.execute("""
        CREATE TABLE IF NOT EXISTS public.step_8_results (
          id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
          migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
          summary text,
          raw_json jsonb DEFAULT '{}'::jsonb,
          created_at timestamp with time zone NOT NULL DEFAULT now(),
          updated_at timestamp with time zone DEFAULT now(),
          UNIQUE(migration_id)
        );
        """)

        cur.execute("""
        CREATE TABLE IF NOT EXISTS public.step_9_results (
          id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
          migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
          summary text,
          raw_json jsonb DEFAULT '{}'::jsonb,
          created_at timestamp with time zone NOT NULL DEFAULT now(),
          updated_at timestamp with time zone DEFAULT now(),
          UNIQUE(migration_id)
        );
        """)

        cur.execute("""
        CREATE TABLE IF NOT EXISTS public.step_10_results (
          id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
          migration_id uuid NOT NULL REFERENCES public.migrations(id) ON DELETE CASCADE,
          summary text,
          raw_json jsonb DEFAULT '{}'::jsonb,
          created_at timestamp with time zone NOT NULL DEFAULT now(),
          updated_at timestamp with time zone DEFAULT now(),
          UNIQUE(migration_id)
        );
        """)

        print("Creating global_stats table...")
        cur.execute("""
        CREATE TABLE IF NOT EXISTS public.global_stats (
          day date PRIMARY KEY DEFAULT CURRENT_DATE,
          steps_completed integer NOT NULL DEFAULT 0,
          objects_migrated integer NOT NULL DEFAULT 0,
          agent_success_count integer NOT NULL DEFAULT 0,
          agent_total_count integer NOT NULL DEFAULT 0,
          reconciliation_accuracy_sum numeric NOT NULL DEFAULT 0.0,
          reconciliation_count integer NOT NULL DEFAULT 0
        );
        """)

        print("Adding enhancements column to mapping_rules if not exists...")
        cur.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mapping_rules' AND column_name='enhancements') THEN
                ALTER TABLE public.mapping_rules ADD COLUMN enhancements jsonb DEFAULT '[]'::jsonb;
            END IF;
        END $$;
        """)

        print("Updating rule_type constraint in mapping_rules...")
        cur.execute("""
        DO $$
        BEGIN
            ALTER TABLE public.mapping_rules DROP CONSTRAINT IF EXISTS mapping_rules_rule_type_check;
            ALTER TABLE public.mapping_rules ADD CONSTRAINT mapping_rules_rule_type_check 
            CHECK (rule_type = ANY (ARRAY['MAP'::text, 'POLISH'::text, 'SUMMARY'::text, 'IGNORE'::text, 'ENHANCE'::text]));
        EXCEPTION
            WHEN OTHERS THEN
                NULL; -- Handle cases where table might not exist yet if CREATE TABLE above fails
        END $$;
        """)
        
        print("Creating index...")
        cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_mapping_chat_messages_migration_id ON public.mapping_chat_messages(migration_id);
        """)
        
        print("Updating jobs table to make step_id nullable...")
        cur.execute("""
        ALTER TABLE public.jobs ALTER COLUMN step_id DROP NOT NULL;
        """)
        
        conn.commit()
        print("Migration successful.")
        conn.close()
        
    except Exception as e:
        print(f"Migration failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    migrate()
