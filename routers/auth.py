from fastapi import APIRouter, HTTPException
from typing import Any
from datetime import datetime, timezone
import psycopg

from models.auth import AuthPayload, SyncUserPayload
from core.database import get_db_connection
from core.security import pwd_context

router = APIRouter()

def _serialize_user_row(row: dict[str, Any]) -> dict[str, Any]:
    """Convert a database user row into a JSON-serializable dict without the password."""

    sanitized = {key: value for key, value in (row or {}).items() if key != "password"}
    created_at = sanitized.get("created_at")

    if isinstance(created_at, datetime):
        sanitized["created_at"] = created_at.astimezone(timezone.utc).isoformat()

    if "id" in sanitized:
        sanitized["id"] = str(sanitized["id"])

    return sanitized


@router.post("/auth/signup")
async def sign_up_user(payload: AuthPayload) -> dict[str, Any]:
    """Create a user record directly in PostgreSQL without Supabase."""

    hashed_password = pwd_context.hash(payload.password)
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO public.users (email, password, full_name) VALUES (%s, %s, %s) RETURNING id, email, password, full_name, created_at",
                (payload.email, hashed_password, payload.full_name),
            )
            user_row = cur.fetchone()
            conn.commit()
            return _serialize_user_row(user_row)
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=400, detail="Nutzer existiert bereits")
    except Exception as exc:  # pragma: no cover - defensive catch for DB errors
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/auth/login")
async def login_user(payload: AuthPayload) -> dict[str, Any]:
    """Validate credentials directly against the Postgres users table."""

    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, email, password, full_name, created_at FROM public.users WHERE email = %s",
                (payload.email,),
            )
            user_row = cur.fetchone()

        if not user_row or not pwd_context.verify(payload.password, user_row.get("password")):
            raise HTTPException(status_code=401, detail="Ungültige Zugangsdaten")

        return _serialize_user_row(user_row)
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive catch for DB errors
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/api/users/sync")
async def sync_user(payload: SyncUserPayload) -> dict[str, Any]:
    """
    Synchronize a user to the database.
    This function handles new users and gracefully merges users from Keycloak
    who may already exist in the database with a different ID but the same email.
    """
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            # Attempt to insert the user. If the email already exists, do nothing.
            # This prevents a crash if a user was created via another method.
            cur.execute(
                """
                INSERT INTO public.users (id, email, full_name, password)
                VALUES (%s, %s, %s, '')
                ON CONFLICT (email) DO NOTHING
                """,
                (payload.id, payload.email, payload.full_name),
            )

            # Whether the user was inserted or already existed, fetch the
            # canonical user record by email. This is now the source of truth.
            cur.execute(
                "SELECT id, email, password, full_name, created_at FROM public.users WHERE email = %s",
                (payload.email,),
            )
            user_row = cur.fetchone()
            conn.commit()

            if not user_row:
                 # This case should be virtually impossible if the previous logic is sound.
                raise HTTPException(status_code=500, detail="Failed to retrieve user after sync.")

            return _serialize_user_row(user_row)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
