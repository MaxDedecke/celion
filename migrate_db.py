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
        
        print("Creating index...")
        cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_mapping_chat_messages_migration_id ON public.mapping_chat_messages(migration_id);
        """)
        
        conn.commit()
        print("Migration successful.")
        conn.close()
        
    except Exception as e:
        print(f"Migration failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    migrate()
