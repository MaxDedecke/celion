from __future__ import annotations

import os
import json
import psycopg
import psycopg.rows
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

def get_db_connection() -> psycopg.Connection:
    """Create a new PostgreSQL connection using environment variables."""
    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        dbname=os.environ.get("POSTGRES_DB", "celion"),
        user=os.environ.get("POSTGRES_USER", "celion"),
        password=os.environ.get("POSTGRES_PASSWORD", "celion"),
        row_factory=psycopg.rows.dict_row,
    )

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
