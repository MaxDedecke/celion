from __future__ import annotations

import os
import json
import psycopg
import psycopg.rows
import psycopg_pool
from contextlib import contextmanager
from typing import Optional, Any
from uuid import UUID
from datetime import datetime, date
from decimal import Decimal

class CustomEncoder(json.JSONEncoder):
    """Custom JSON encoder to handle UUID and datetime objects."""
    def default(self, obj):
        if isinstance(obj, UUID):
            return str(obj)
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)

def json_dumps(data: Any) -> str:
    """Helper to dump JSON using the CustomEncoder."""
    return json.dumps(data, cls=CustomEncoder)

pool: Optional[psycopg_pool.ConnectionPool] = None

def init_db_pool():
    """Initializes the global connection pool."""
    global pool
    if pool is not None:
        return
    conninfo = (
        f"host={os.environ.get('POSTGRES_HOST', 'localhost')} "
        f"port={os.environ.get('POSTGRES_PORT', '5432')} "
        f"dbname={os.environ.get('POSTGRES_DB', 'celion')} "
        f"user={os.environ.get('POSTGRES_USER', 'celion')} "
        f"password={os.environ.get('POSTGRES_PASSWORD', 'celion')}"
    )
    pool = psycopg_pool.ConnectionPool(
        conninfo=conninfo,
        min_size=1,
        max_size=int(os.environ.get("POSTGRES_POOL_MAX_SIZE", "20")),
        kwargs={"row_factory": psycopg.rows.dict_row},
    )

def close_db_pool():
    """Closes the global connection pool."""
    global pool
    if pool is not None:
        pool.close()
        pool = None

@contextmanager
def get_db_connection():
    """Yield a connection from the pool. Automatically commits on exit if no exception was raised."""
    if pool is None:
        init_db_pool()
        
    # We assert pool is not None for type checkers, though init_db_pool guarantees it.
    assert pool is not None
    
    with pool.connection() as conn:
        try:
            yield conn
            # Emulate the auto-commit behavior of psycopg.connect() used in a context manager
            if not conn.closed:
                conn.commit()
        except Exception:
            if not conn.closed:
                conn.rollback()
            raise

def get_llm_settings(conn: psycopg.Connection):
    """Fetches the latest LLM settings from the database."""
    with conn.cursor() as cur:
        cur.execute("SELECT provider, model, base_url, api_key FROM public.llm_settings ORDER BY updated_at DESC LIMIT 1")
        settings = cur.fetchone()
        
        # If no settings in DB, try environment variables
        if not settings:
            api_key = os.environ.get("OPENAI_API_KEY")
            if not api_key:
                api_key = os.environ.get("ANTHROPIC_API_KEY")
                provider = "anthropic" if api_key else "openai"
                if not api_key:
                     api_key = os.environ.get("GEMINI_API_KEY")
                     provider = "google" if api_key else "openai"

            settings = {
                "provider": provider,
                "model": "gpt-4o",
                "base_url": None,
                "api_key": api_key,
            }
        return settings
