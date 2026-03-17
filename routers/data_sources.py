from __future__ import annotations
from typing import Any, Optional
import os
import psycopg
import psycopg.rows
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
import json
from core.database import get_db_connection

router = APIRouter()

class DataSource(BaseModel):
    """Pydantic model for a data source."""
    id: str
    name: str
    source_type: str
    api_url: Optional[str] = None
    auth_type: str
    is_active: bool
    is_global: bool
    user_id: str
    additional_config: Optional[dict] = None
    created_at: str
    updated_at: Optional[str] = None
    # Add fields that might be stored in additional_config for completeness
    api_key: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    email: Optional[str] = None


class CreateDataSourcePayload(BaseModel):
    """Pydantic model for creating a data source."""
    name: str
    source_type: str
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    email: Optional[str] = None
    auth_type: str
    is_active: bool
    is_global: bool
    additional_config: Optional[dict] = None
    user_id: str

class UpdateDataSourcePayload(BaseModel):
    """Pydantic model for updating a data source."""
    name: Optional[str] = None
    source_type: Optional[str] = None
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    email: Optional[str] = None
    auth_type: Optional[str] = None
    is_active: Optional[bool] = None
    is_global: Optional[bool] = None
    additional_config: Optional[dict] = None

@router.post("", response_model=DataSource)
async def create_data_source(payload: CreateDataSourcePayload) -> DataSource:
    """Create a new data source in the database."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            additional_config_json = json.dumps(payload.additional_config) if payload.additional_config else None
            
            cur.execute(
                """
                INSERT INTO public.data_sources (
                    name, source_type, api_url, api_key, username, password, email,
                    auth_type, is_active, is_global, additional_config, user_id
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, name, source_type, api_url, auth_type, is_active, 
                          is_global, user_id, additional_config, created_at, updated_at,
                          api_key, username, password, email
                """,
                (
                    payload.name,
                    payload.source_type,
                    payload.api_url,
                    payload.api_key,
                    payload.username,
                    payload.password,
                    payload.email,
                    payload.auth_type,
                    payload.is_active,
                    payload.is_global,
                    additional_config_json,
                    payload.user_id,
                ),
            )
            row = cur.fetchone()
            conn.commit()

            if not row:
                raise HTTPException(status_code=500, detail="Failed to create data source.")

            return DataSource(
                id=str(row["id"]),
                name=row["name"],
                source_type=row["source_type"],
                api_url=row.get("api_url"),
                auth_type=row["auth_type"],
                is_active=row["is_active"],
                is_global=row["is_global"],
                user_id=str(row["user_id"]),
                additional_config=row.get("additional_config"),
                created_at=row["created_at"].isoformat(),
                updated_at=row["updated_at"].isoformat() if row.get("updated_at") else None,
                api_key=row.get("api_key"),
                username=row.get("username"),
                password=row.get("password"),
                email=row.get("email"),
            )
    except Exception as exc:
        print(f"Error creating data source: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to create data source: {str(exc)}") from exc


@router.get("", response_model=list[DataSource])
async def get_data_sources(user_id: Optional[str] = None) -> list[DataSource]:
    """Fetch data sources from the database."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            query = """
                SELECT id, name, source_type, api_url, auth_type, is_active, 
                       is_global, user_id, additional_config, created_at, updated_at,
                       api_key, username, password, email
                FROM public.data_sources
            """
            params = []
            if user_id:
                query += " WHERE user_id = %s OR is_global = TRUE"
                params.append(user_id)
            
            query += " ORDER BY created_at DESC"
            
            cur.execute(query, tuple(params))
            rows = cur.fetchall()

            data_sources = [
                DataSource(
                    id=str(row["id"]),
                    name=row["name"],
                    source_type=row["source_type"],
                    api_url=row.get("api_url"),
                    auth_type=row["auth_type"],
                    is_active=row["is_active"],
                    is_global=row["is_global"],
                    user_id=str(row["user_id"]),
                    additional_config=row.get("additional_config"),
                    created_at=row["created_at"].isoformat(),
                    updated_at=row["updated_at"].isoformat() if row.get("updated_at") else None,
                    api_key=row.get("api_key"),
                    username=row.get("username"),
                    password=row.get("password"),
                    email=row.get("email"),
                )
                for row in rows
            ]
            return data_sources
    except Exception as exc:
        print(f"Error fetching data sources: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch data sources: {str(exc)}") from exc

@router.patch("/{source_id}", response_model=DataSource)
async def update_data_source(source_id: str, payload: UpdateDataSourcePayload) -> DataSource:
    """Update an existing data source."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            # First check if exists
            cur.execute("SELECT id FROM public.data_sources WHERE id = %s", (source_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Data source not found")

            update_data = payload.model_dump(exclude_unset=True)
            if not update_data:
                # Nothing to update
                cur.execute("""
                    SELECT id, name, source_type, api_url, auth_type, is_active, 
                           is_global, user_id, additional_config, created_at, updated_at,
                           api_key, username, password, email
                    FROM public.data_sources WHERE id = %s
                """, (source_id,))
                row = cur.fetchone()
                return DataSource(**row)

            fields = []
            values = []
            for field, value in update_data.items():
                fields.append(f"{field} = %s")
                if field == "additional_config":
                    values.append(json.dumps(value))
                else:
                    values.append(value)
            
            fields.append("updated_at = now()")
            
            query = f"UPDATE public.data_sources SET {', '.join(fields)} WHERE id = %s RETURNING *"
            values.append(source_id)
            
            cur.execute(query, tuple(values))
            row = cur.fetchone()
            conn.commit()

            return DataSource(
                id=str(row["id"]),
                name=row["name"],
                source_type=row["source_type"],
                api_url=row.get("api_url"),
                auth_type=row["auth_type"],
                is_active=row["is_active"],
                is_global=row["is_global"],
                user_id=str(row["user_id"]),
                additional_config=row.get("additional_config"),
                created_at=row["created_at"].isoformat(),
                updated_at=row["updated_at"].isoformat() if row.get("updated_at") else None,
                api_key=row.get("api_key"),
                username=row.get("username"),
                password=row.get("password"),
                email=row.get("email"),
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error updating data source: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to update data source: {str(exc)}") from exc

@router.delete("/{source_id}")
async def delete_data_source(source_id: str):
    """Delete a data source."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            # Delete project assignments first (foreign key constraints)
            cur.execute("DELETE FROM public.data_source_projects WHERE data_source_id = %s", (source_id,))
            
            cur.execute("DELETE FROM public.data_sources WHERE id = %s RETURNING id", (source_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Data source not found")
            conn.commit()
            return {"status": "success", "message": "Data source deleted"}
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error deleting data source: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to delete data source: {str(exc)}") from exc
