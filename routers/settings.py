import os
import json
from fastapi import APIRouter, HTTPException
from typing import Any
import psycopg.rows
import traceback

from core.database import get_db_connection

router = APIRouter()

@router.get("/schemes/objects/{system_name}")
async def get_system_object_specs(system_name: str) -> dict[str, Any]:
    """Fetch object specifications for a given system from the schemes/objects directory."""
    try:
        # Normalize system name to filename
        import re
        normalized = "".join(re.findall(r"[a-z0-9]", system_name.lower()))
        filename = f"{normalized}_objects.json"
        
        scheme_path = os.path.join(os.getcwd(), "schemes", "objects", filename)
        
        if not os.path.exists(scheme_path):
            raise HTTPException(status_code=404, detail=f"Object specs for system '{system_name}' not found at {scheme_path}")
            
        with open(scheme_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@router.get("/llm-settings")
async def get_llm_settings():
    try:
        with get_db_connection() as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute("SELECT id, provider, model, base_url, api_key FROM public.llm_settings ORDER BY updated_at DESC")
            settings = cur.fetchall()
            # Mask api_key for security
            for s in settings:
                if s.get('api_key'):
                    s['api_key'] = "************"
            return settings
    except Exception as exc:
        print(f"Error in GET /api/llm-settings: {exc}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))

@router.post("/llm-settings")
async def save_llm_settings(settings: dict):
    try:
        with get_db_connection() as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            if settings.get('api_key'):
                cur.execute("""
                    INSERT INTO public.llm_settings (provider, model, base_url, api_key)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        provider = EXCLUDED.provider,
                        model = EXCLUDED.model,
                        base_url = EXCLUDED.base_url,
                        api_key = EXCLUDED.api_key,
                        updated_at = now()
                """, (settings.get('provider'), settings.get('model'), settings.get('base_url'), settings.get('api_key')))
            else:
                cur.execute("""
                    INSERT INTO public.llm_settings (provider, model, base_url)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        provider = EXCLUDED.provider,
                        model = EXCLUDED.model,
                        base_url = EXCLUDED.base_url,
                        updated_at = now()
                """, (settings.get('provider'), settings.get('model'), settings.get('base_url')))
            conn.commit()
            return {"status": "success"}
    except Exception as exc:
        print(f"Error in POST /api/llm-settings: {exc}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))
