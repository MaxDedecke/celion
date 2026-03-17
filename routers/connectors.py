import json
from fastapi import APIRouter, HTTPException
from typing import Any, Optional

from models.connectors import Connector, CreateConnectorPayload, UpdateConnectorPayload
from core.database import get_db_connection

router = APIRouter()

def _row_to_connector(row: dict[str, Any]) -> Connector:
    """Convert a database row to a Connector model."""
    return Connector(
        id=str(row["id"]),
        migration_id=str(row["migration_id"]),
        connector_type=row["connector_type"],
        api_url=row.get("api_url"),
        api_key=row.get("api_key"),
        username=row.get("username"),
        password=row.get("password"),
        endpoint=row.get("endpoint"),
        auth_type=row.get("auth_type", "api_key"),
        additional_config=row.get("additional_config"),
        is_tested=row.get("is_tested", False),
        created_at=row["created_at"].isoformat() if row.get("created_at") else "",
        updated_at=row["updated_at"].isoformat() if row.get("updated_at") else None,
    )


def _strip_eq_prefix(value: Optional[str]) -> Optional[str]:
    """Normalize PostgREST-style filter values by removing the `eq.` prefix."""

    if value and value.startswith("eq."):
        return value.replace("eq.", "", 1)
    return value


@router.post("", response_model=list[Connector])
async def create_connectors(payloads: list[CreateConnectorPayload]) -> list[Connector]:
    """Create one or more connectors in the database."""
    try:
        connectors: list[Connector] = []
        with get_db_connection() as conn, conn.cursor() as cur:
            for payload in payloads:
                additional_config_json = json.dumps(payload.additional_config) if payload.additional_config else None
                
                cur.execute(
                    """
                    INSERT INTO public.connectors (
                        migration_id, connector_type, api_url, api_key, 
                        username, password, endpoint, auth_type, additional_config
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id, migration_id, connector_type, api_url, api_key, 
                              username, password, endpoint, auth_type, additional_config, 
                              is_tested, created_at, updated_at
                    """,
                    (
                        payload.migration_id,
                        payload.connector_type,
                        payload.api_url,
                        payload.api_key,
                        payload.username,
                        payload.password,
                        payload.endpoint,
                        payload.auth_type,
                        additional_config_json,
                    ),
                )
                row = cur.fetchone()
                if row:
                    connectors.append(_row_to_connector(row))
            conn.commit()
        return connectors
    except Exception as exc:
        print(f"Error creating connectors: {exc}")
        raise HTTPException(status_code=500, detail="Failed to create connectors.") from exc


@router.get("", response_model=list[Connector])
async def get_connectors(
    migration_id: Optional[str] = None,
    connector_type: Optional[str] = None,
) -> list[Connector]:
    """Fetch connectors, optionally filtered by migration_id and/or connector_type."""

    migration_id = _strip_eq_prefix(migration_id)
    connector_type = _strip_eq_prefix(connector_type)
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            query = """
                SELECT id, migration_id, connector_type, api_url, api_key, 
                       username, password, endpoint, auth_type, additional_config, 
                       is_tested, created_at, updated_at
                FROM public.connectors
            """
            conditions: list[str] = []
            params: list[Any] = []

            if migration_id:
                conditions.append("migration_id = %s")
                params.append(migration_id)
            if connector_type:
                conditions.append("connector_type = %s")
                params.append(connector_type)

            if conditions:
                query += " WHERE " + " AND ".join(conditions)

            query += " ORDER BY created_at DESC"

            cur.execute(query, tuple(params))
            rows = cur.fetchall()
            return [_row_to_connector(row) for row in rows]
    except Exception as exc:
        print(f"Error fetching connectors: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch connectors.") from exc


@router.patch("")
async def update_connector(
    id: Optional[str] = None,
    migration_id: Optional[str] = None,
    connector_type: Optional[str] = None,
    payload: UpdateConnectorPayload = None,
) -> Connector:
    """Update a connector by id or by migration_id + connector_type."""
    if not id and not (migration_id and connector_type):
        raise HTTPException(
            status_code=400,
            detail="Either 'id' or both 'migration_id' and 'connector_type' are required.",
        )

    id = _strip_eq_prefix(id)
    migration_id = _strip_eq_prefix(migration_id)
    connector_type = _strip_eq_prefix(connector_type)

    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            # Build SET clause dynamically from non-None payload fields
            updates: list[str] = []
            params: list[Any] = []
            
            if payload:
                payload_dict = payload.model_dump(exclude_none=True)
                for field, value in payload_dict.items():
                    if isinstance(value, dict):
                        updates.append(f"{field} = %s")
                        params.append(json.dumps(value))
                    else:
                        updates.append(f"{field} = %s")
                        params.append(value)
            
            if not updates:
                raise HTTPException(status_code=400, detail="No fields to update.")
            
            updates.append("updated_at = now()")
            
            # Build WHERE clause
            where_conditions: list[str] = []
            if id:
                where_conditions.append("id = %s")
                params.append(id)
            else:
                where_conditions.append("migration_id = %s")
                params.append(migration_id)
                where_conditions.append("connector_type = %s")
                params.append(connector_type)
            
            query = f"""
                UPDATE public.connectors
                SET {", ".join(updates)}
                WHERE {" AND ".join(where_conditions)}
                RETURNING id, migration_id, connector_type, api_url, api_key, 
                          username, password, endpoint, auth_type, additional_config, 
                          is_tested, created_at, updated_at
            """
            
            cur.execute(query, tuple(params))
            row = cur.fetchone()
            conn.commit()
            
            if not row:
                raise HTTPException(status_code=404, detail="Connector not found.")
            
            return _row_to_connector(row)
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error updating connector: {exc}")
        raise HTTPException(status_code=500, detail="Failed to update connector.") from exc
