"""Celion FastAPI entry point now providing legacy notices only."""
# pyright: reportMissingImports=false

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Union

import os

import psycopg
import psycopg.rows
import requests
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from starlette.concurrency import run_in_threadpool


LEGACY_MESSAGE = "The legacy Python-based agents have been removed in favor of the frontend implementation."

app = FastAPI(title="Celion Agent Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count"],
)


def _get_db_connection() -> psycopg.Connection:
    """Create a new PostgreSQL connection using environment variables."""

    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        dbname=os.environ.get("POSTGRES_DB", "celion"),
        user=os.environ.get("POSTGRES_USER", "celion"),
        password=os.environ.get("POSTGRES_PASSWORD", "celion"),
        row_factory=psycopg.rows.dict_row,
    )


def _serialize_user_row(row: dict[str, Any]) -> dict[str, Any]:
    """Convert a database user row into a JSON-serializable dict without the password."""

    sanitized = {key: value for key, value in (row or {}).items() if key != "password"}
    created_at = sanitized.get("created_at")

    if isinstance(created_at, datetime):
        sanitized["created_at"] = created_at.astimezone(timezone.utc).isoformat()

    return sanitized


class Project(BaseModel):
    """Pydantic model for a project."""

    id: str
    name: str
    description: Optional[str] = None
    created_at: str


class DetectionRequest(BaseModel):
    """Request payload kept for backward compatibility with legacy clients."""

    url: HttpUrl


class LegacyResponse(BaseModel):
    """Response returned when legacy agent endpoints are invoked."""

    message: str


class ProbeEvidence(BaseModel):
    """Metadata describing the performed credential probe."""

    request_url: Union[HttpUrl, str]
    method: str
    used_headers: list[str]
    timestamp: str


class ProbeRequest(BaseModel):
    """Request payload for forwarding credential probes through the backend."""

    method: str
    url: HttpUrl
    headers: dict[str, str]
    body: Optional[Any] = None
    request_format: Optional[str] = None
    graphql: Optional[Dict[str, Any]] = None


class ProbeResponse(BaseModel):
    """Normalized response returned to the frontend after performing the probe."""

    status: Optional[int]
    ok: bool
    body: Optional[Any]
    raw_response: Optional[str]
    error: Optional[str]
    evidence: ProbeEvidence


SchemaProbeRequest = ProbeRequest
SchemaProbeResponse = ProbeResponse


class AuthPayload(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None


class HttpClientRequest(BaseModel):
    """Generic HTTP request payload executed by the backend."""

    url: HttpUrl
    method: str
    headers: Optional[Dict[str, str]] = None
    body: Optional[Any] = None


class HttpClientResponse(BaseModel):
    """Normalized HTTP response for the agent httpClient tool."""

    status: Optional[int]
    headers: dict[str, str]
    body: Optional[Any]
    error: Optional[str] = None


class CurlHeadProbeRequest(BaseModel):
    """Request payload for executing a curl-style HEAD probe via the backend."""

    url: HttpUrl
    headers: Optional[Dict[str, str]] = None
    follow_redirects: bool = True


class CurlHeadProbeResponse(BaseModel):
    """Normalized response for curl_head_probe to expose headers and redirects."""

    status: Optional[int]
    headers: dict[str, str]
    redirects: list[dict[str, Any]]
    final_url: Optional[str]
    raw_response: Optional[str]
    error: Optional[str] = None


class RunStepRequest(BaseModel):
    """Request payload to enqueue an agent step for background execution."""

    migrationId: str
    agentName: str
    agentParams: Optional[Dict[str, Any]] = None
    stepId: Optional[str] = None
    stepName: Optional[str] = None


def _legacy_http_exception() -> HTTPException:
    """Provide a consistent 410 response when legacy endpoints are used."""

    return HTTPException(status_code=410, detail=LEGACY_MESSAGE)


@app.post("/agents/system-detection", response_model=LegacyResponse)
async def run_system_detection(payload: DetectionRequest) -> LegacyResponse:
    """Inform callers that the Python discovery agent has been removed."""
    print(f"run_system_detection called with payload: {payload}")
    raise _legacy_http_exception()


@app.post("/auth/signup")
async def sign_up_user(payload: AuthPayload) -> dict[str, Any]:
    """Create a user record directly in PostgreSQL without Supabase."""

    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO public.users (email, password, full_name) VALUES (%s, %s, %s) RETURNING id, email, password, full_name, created_at",
                (payload.email, payload.password, payload.full_name),
            )
            user_row = cur.fetchone()
            conn.commit()
            return _serialize_user_row(user_row)
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=400, detail="Nutzer existiert bereits")
    except Exception as exc:  # pragma: no cover - defensive catch for DB errors
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/auth/login")
async def login_user(payload: AuthPayload) -> dict[str, Any]:
    """Validate credentials directly against the Postgres users table."""

    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, email, password, full_name, created_at FROM public.users WHERE email = %s",
                (payload.email,),
            )
            user_row = cur.fetchone()

        if not user_row or user_row.get("password") != payload.password:
            raise HTTPException(status_code=401, detail="Ungültige Zugangsdaten")

        return _serialize_user_row(user_row)
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive catch for DB errors
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/projects", response_model=list[Project])
async def get_projects() -> list[Project]:
    """Fetch all projects from the database."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, description, created_at FROM public.projects ORDER BY created_at DESC"
            )
            project_rows = cur.fetchall()
            projects = [
                Project(
                    id=str(row["id"]),
                    name=row["name"],
                    description=row["description"],
                    created_at=row["created_at"].isoformat(),
                )
                for row in project_rows
            ]
            return projects
    except Exception as exc:
        # Log the exception for debugging purposes
        print(f"Error fetching projects: {exc}")
        # Return an empty list or raise an HTTPException
        raise HTTPException(status_code=500, detail="Failed to fetch projects.") from exc


class Migration(BaseModel):
    """Pydantic model for a migration."""

    id: str
    name: str
    source_system: str
    target_system: str
    source_url: str
    target_url: str
    in_connector: Optional[str] = None
    in_connector_detail: Optional[str] = None
    out_connector: Optional[str] = None
    out_connector_detail: Optional[str] = None
    objects_transferred: Optional[str] = None
    mapped_objects: Optional[str] = None
    project_id: Optional[str] = None
    notes: Optional[str] = None
    workflow_state: Optional[dict] = None
    progress: Optional[int] = 0
    created_at: str
    updated_at: Optional[str] = None


class MigrationActivity(BaseModel):
    """Pydantic model for a migration activity."""
    id: str
    migration_id: str
    type: str
    title: str
    timestamp: str
    created_at: Optional[str] = None


class CreateMigrationActivityPayload(BaseModel):
    """Pydantic model for creating a migration activity."""
    migration_id: str
    type: str
    title: str
    timestamp: str


class CreateMigrationPayload(BaseModel):
    """Pydantic model for creating a migration."""

    name: str
    source_system: str
    target_system: str
    source_url: str
    target_url: str
    project_id: Optional[str] = None
    user_id: str
    in_connector: str
    in_connector_detail: str
    out_connector: str
    out_connector_detail: str
    status: Optional[str] = "not_started"


@app.post("/api/migrations", response_model=Migration)
async def create_migration(payload: CreateMigrationPayload) -> Migration:
    """Create a new migration in the database."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.migrations (
                    name, source_system, target_system, source_url, target_url, 
                    project_id, user_id, in_connector, in_connector_detail, 
                    out_connector, out_connector_detail, status
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, name, source_system, target_system, source_url, target_url, in_connector, in_connector_detail, out_connector, out_connector_detail, objects_transferred, mapped_objects, project_id, notes, workflow_state, progress, created_at, updated_at
                """,
                (
                    payload.name,
                    payload.source_system,
                    payload.target_system,
                    payload.source_url,
                    payload.target_url,
                    payload.project_id,
                    payload.user_id,
                    payload.in_connector,
                    payload.in_connector_detail,
                    payload.out_connector,
                    payload.out_connector_detail,
                    payload.status,
                ),
            )
            row = cur.fetchone()
            conn.commit()

            if not row:
                raise HTTPException(status_code=500, detail="Failed to create migration.")

            return Migration(
                id=str(row["id"]),
                name=row["name"],
                source_system=row["source_system"],
                target_system=row["target_system"],
                source_url=row["source_url"],
                target_url=row["target_url"],
                in_connector=row["in_connector"],
                in_connector_detail=row["in_connector_detail"],
                out_connector=row["out_connector"],
                out_connector_detail=row["out_connector_detail"],
                objects_transferred=row["objects_transferred"],
                mapped_objects=row["mapped_objects"],
                project_id=str(row["project_id"]) if row["project_id"] else None,
                notes=row["notes"],
                workflow_state=row["workflow_state"],
                progress=row["progress"],
                created_at=row["created_at"].isoformat(),
                updated_at=row["updated_at"].isoformat() if row["updated_at"] else None,
            )
    except Exception as exc:
        print(f"Error creating migration: {exc}")
        raise HTTPException(status_code=500, detail="Failed to create migration.") from exc


@app.post(
    "/api/migration_activities",
    response_model=Union[MigrationActivity, list[MigrationActivity]],
)
async def insert_migration_activity(
    payload: Union[CreateMigrationActivityPayload, list[CreateMigrationActivityPayload]]
) -> Union[MigrationActivity, list[MigrationActivity]]:
    """Insert one or many migration activities into the database."""

    def _insert_activity(cur: psycopg.Cursor, item: CreateMigrationActivityPayload) -> dict[str, Any]:
        cur.execute(
            """
            INSERT INTO public.migration_activities (migration_id, type, title, timestamp)
            VALUES (%s, %s, %s, %s)
            RETURNING id, migration_id, type, title, timestamp, created_at
            """,
            (item.migration_id, item.type, item.title, item.timestamp),
        )
        return cur.fetchone()

    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            items = payload if isinstance(payload, list) else [payload]
            inserted_rows = [_insert_activity(cur, item) for item in items]
            conn.commit()

            activities = [
                MigrationActivity(
                    id=str(row["id"]),
                    migration_id=str(row["migration_id"]),
                    type=row["type"],
                    title=row["title"],
                    timestamp=str(row["timestamp"]),
                    created_at=row["created_at"].isoformat()
                    if hasattr(row["created_at"], "isoformat")
                    else str(row["created_at"])
                    if row["created_at"]
                    else None,
                )
                for row in inserted_rows
            ]

            if isinstance(payload, list):
                return activities

            return activities[0]
    except Exception as exc:
        print(f"Error inserting migration activity: {exc}")
        raise HTTPException(status_code=500, detail="Failed to insert migration activity.") from exc


@app.get("/api/migration_activities", response_model=list[MigrationActivity])
async def get_migration_activities(
    response: Response,
    migration_id: Optional[str] = None,
    limit: int = 15,
    offset: int = 0,
) -> list[MigrationActivity]:
    """Fetch migration activities from the database, optionally filtered by migration_id."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            count_query = "SELECT COUNT(*) FROM public.migration_activities"
            query = "SELECT id, migration_id, type, title, timestamp, created_at FROM public.migration_activities"

            params = []
            where_clause = ""

            if migration_id:
                if migration_id.startswith("eq."):
                    where_clause = " WHERE migration_id = %s"
                    params.append(migration_id.replace("eq.", ""))
                else: # fallback for just id
                    where_clause = " WHERE migration_id = %s"
                    params.append(migration_id)
            
            count_query += where_clause
            query += where_clause

            cur.execute(count_query, tuple(params))
            count_result = cur.fetchone()
            total_count = count_result['count'] if count_result else 0

            query += " ORDER BY timestamp DESC LIMIT %s OFFSET %s"
            params.extend([limit, offset])

            cur.execute(query, tuple(params))
            activity_rows = cur.fetchall()

            activities = [
                MigrationActivity(
                    id=str(row["id"]),
                    migration_id=str(row["migration_id"]),
                    type=row["type"],
                    title=row["title"],
                    timestamp=str(row["timestamp"]),
                    created_at=row["created_at"].isoformat()
                    if hasattr(row["created_at"], "isoformat")
                    else str(row["created_at"])
                    if row["created_at"]
                    else None,
                )
                for row in activity_rows
            ]

            response.headers["X-Total-Count"] = str(total_count)

            return activities
    except Exception as exc:
        print(f"Error fetching migration activities: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch migration activities.") from exc


@app.get("/api/migrations", response_model=list[Migration])
async def get_migrations(
    response: Response,
    project_id: Optional[str] = None,
    limit: int = 15,
    offset: int = 0,
) -> list[Migration]:
    """Fetch migrations from the database."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            
            count_query = "SELECT COUNT(*) FROM public.migrations"
            query = "SELECT id, name, source_system, target_system, source_url, target_url, in_connector, in_connector_detail, out_connector, out_connector_detail, objects_transferred, mapped_objects, project_id, notes, workflow_state, progress, created_at, updated_at FROM public.migrations"
            
            params = []
            
            if project_id:
                if project_id == "is.null":
                    where_clause = " WHERE project_id IS NULL"
                elif project_id.startswith("eq."):
                    where_clause = " WHERE project_id = %s"
                    params.append(project_id.replace("eq.", ""))
                else: # fallback for just id
                    where_clause = " WHERE project_id = %s"
                    params.append(project_id)
                
                count_query += where_clause
                query += where_clause

            cur.execute(count_query, tuple(params))
            count_result = cur.fetchone()
            total_count = count_result['count'] if count_result else 0
            
            query += " ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT %s OFFSET %s"
            params.extend([limit, offset])

            cur.execute(query, tuple(params))
            migration_rows = cur.fetchall()

            migrations = [
                Migration(
                    id=str(row["id"]),
                    name=row["name"],
                    source_system=row["source_system"],
                    target_system=row["target_system"],
                    source_url=row["source_url"],
                    target_url=row["target_url"],
                    in_connector=row["in_connector"],
                    in_connector_detail=row["in_connector_detail"],
                    out_connector=row["out_connector"],
                    out_connector_detail=row["out_connector_detail"],
                    objects_transferred=row["objects_transferred"],
                    mapped_objects=row["mapped_objects"],
                    project_id=str(row["project_id"]) if row["project_id"] else None,
                    notes=row["notes"],
                    workflow_state=row["workflow_state"],
                    progress=row["progress"],
                    created_at=row["created_at"].isoformat(),
                    updated_at=row["updated_at"].isoformat() if row["updated_at"] else None,
                )
                for row in migration_rows
            ]
            
            response.headers["X-Total-Count"] = str(total_count)
            
            return migrations
            
    except Exception as exc:
        print(f"Error fetching migrations: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch migrations.") from exc


@app.delete("/api/migrations")
async def delete_migration(
    id: str,
) -> dict[str, str]:
    """Delete a migration and its related records from the database."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            # Check if migration exists
            cur.execute("SELECT id FROM public.migrations WHERE id = %s", (id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Migration not found.")

            # Delete related migration activities
            cur.execute("DELETE FROM public.migration_activities WHERE migration_id = %s", (id,))
            # Delete related connectors
            cur.execute("DELETE FROM public.connectors WHERE migration_id = %s", (id,))
            # Delete the migration itself
            cur.execute("DELETE FROM public.migrations WHERE id = %s", (id,))
            
            conn.commit()
            
            return {"message": f"Migration {id} and related records deleted successfully."}
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error deleting migration: {exc}")
        raise HTTPException(status_code=500, detail="Failed to delete migration.") from exc




# ============================================================================
# Connector Endpoints
# ============================================================================

class Connector(BaseModel):
    """Pydantic model for a connector."""
    id: str
    migration_id: str
    connector_type: str  # 'in' or 'out'
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    endpoint: Optional[str] = None
    auth_type: str = "api_key"
    additional_config: Optional[dict] = None
    is_tested: bool = False
    created_at: str
    updated_at: Optional[str] = None


class CreateConnectorPayload(BaseModel):
    """Pydantic model for creating a connector."""
    migration_id: str
    connector_type: str  # 'in' or 'out'
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    endpoint: Optional[str] = None
    auth_type: str = "api_key"
    additional_config: Optional[dict] = None


class UpdateConnectorPayload(BaseModel):
    """Pydantic model for updating a connector."""
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    endpoint: Optional[str] = None
    auth_type: Optional[str] = None
    additional_config: Optional[dict] = None
    is_tested: Optional[bool] = None


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


@app.post("/api/connectors", response_model=list[Connector])
async def create_connectors(payloads: list[CreateConnectorPayload]) -> list[Connector]:
    """Create one or more connectors in the database."""
    try:
        connectors: list[Connector] = []
        with _get_db_connection() as conn, conn.cursor() as cur:
            for payload in payloads:
                import json
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


@app.get("/api/connectors", response_model=list[Connector])
async def get_connectors(
    migration_id: Optional[str] = None,
    connector_type: Optional[str] = None,
) -> list[Connector]:
    """Fetch connectors, optionally filtered by migration_id and/or connector_type."""

    migration_id = _strip_eq_prefix(migration_id)
    connector_type = _strip_eq_prefix(connector_type)
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
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


@app.patch("/api/connectors")
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
        with _get_db_connection() as conn, conn.cursor() as cur:
            # Build SET clause dynamically from non-None payload fields
            updates: list[str] = []
            params: list[Any] = []
            
            if payload:
                payload_dict = payload.model_dump(exclude_none=True)
                for field, value in payload_dict.items():
                    if field == "additional_config" and value is not None:
                        import json
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


# ============================================================================
# Legacy Endpoints
# ============================================================================

@app.get("/auth-flow", response_model=LegacyResponse)
async def run_auth_flow(
    base_url: str,
    system: str,
    auth_type: str,
    api_token: Optional[str] = None,
    username: Optional[str] = None,
    password: Optional[str] = None,
) -> LegacyResponse:
    """Inform callers that the Python auth flow agent has been removed."""
    print(f"run_auth_flow called with base_url: {base_url}, system: {system}, auth_type: {auth_type}")
    raise _legacy_http_exception()


@app.post("/api/probe", response_model=ProbeResponse)
async def run_credential_probe(payload: ProbeRequest) -> ProbeResponse:
    """Execute credential probe requests on the server to avoid browser CORS limits."""
    print(f"run_credential_probe called with payload: {payload}")
    timestamp = datetime.now(timezone.utc).isoformat()
    headers = dict(payload.headers)
    used_headers: list[str] = list(headers.keys())

    try:
        def _perform_request() -> requests.Response:
            nonlocal used_headers
            request_kwargs: dict[str, Any] = {
                "method": payload.method,
                "url": str(payload.url),
                "headers": headers,
            }

            request_body = payload.body

            if (payload.request_format or "").lower() == "graphql":
                graphql_payload = payload.graphql or {}
                query = graphql_payload.get("query") or (payload.body if isinstance(payload.body, str) else None)
                request_body = {
                    "query": query or "{ __typename }",
                    **(
                        {"operationName": graphql_payload.get("operation_name")}
                        if graphql_payload.get("operation_name")
                        else {}
                    ),
                    **(
                        {"variables": graphql_payload.get("variables")}
                        if graphql_payload.get("variables") is not None
                        else {}
                    ),
                }
                headers.setdefault("Content-Type", "application/json")

            if request_body is not None:
                if isinstance(request_body, (dict, list)):
                    request_kwargs["json"] = request_body
                else:
                    request_kwargs["data"] = request_body

            used_headers = list(headers.keys())

            return requests.request(**request_kwargs)

        response = await run_in_threadpool(_perform_request)
        content_type = response.headers.get("content-type", "").lower()

        body: Optional[Any]
        raw_response: Optional[str]
        if "application/json" in content_type:
            try:
                body = response.json()
            except Exception:
                body = response.text[:500]
        else:
            body = response.text[:500]

        return ProbeResponse(
            status=response.status_code,
            ok=response.ok,
            body=body,
            raw_response=response.text[:500],
            error=None,
            evidence=ProbeEvidence(
                request_url=str(payload.url),
                method=payload.method,
                used_headers=used_headers,
                timestamp=timestamp,
            ),
        )
    except Exception as exc:  # pylint: disable=broad-except
        return ProbeResponse(
            status=None,
            ok=False,
            body=None,
            raw_response=None,
            error=str(exc),
            evidence=ProbeEvidence(
                request_url=str(payload.url),
                method=payload.method,
                used_headers=used_headers,
                timestamp=timestamp,
            ),
        )


@app.post("/api/schema-probe", response_model=SchemaProbeResponse)
async def run_schema_probe(payload: SchemaProbeRequest) -> SchemaProbeResponse:
    """Perform generic schema discovery requests on behalf of the agent."""
    print(f"run_schema_probe called with payload: {payload}")
    return await run_credential_probe(payload)  # type: ignore[arg-type]


@app.post("/api/http-client", response_model=HttpClientResponse)
async def run_http_client(payload: HttpClientRequest) -> HttpClientResponse:
    """Execute arbitrary HTTP requests on behalf of the agent without browser CORS limits."""
    print(f"run_http_client called with payload: {payload}")
    headers = dict(payload.headers or {})

    try:
        def _perform_request() -> requests.Response:
            request_kwargs: dict[str, Any] = {
                "method": payload.method,
                "url": str(payload.url),
                "headers": headers,
            }

            if payload.body is not None:
                if isinstance(payload.body, (dict, list)):
                    request_kwargs["json"] = payload.body
                else:
                    request_kwargs["data"] = payload.body

            return requests.request(**request_kwargs)

        response = await run_in_threadpool(_perform_request)

        content_type = response.headers.get("content-type", "").lower()
        response_headers = {k: v for k, v in response.headers.items()}

        body: Optional[Any]
        if "application/json" in content_type:
            try:
                body = response.json()
            except Exception:  # pylint: disable=broad-except
                body = response.text
        else:
            body = response.text

        return HttpClientResponse(
            status=response.status_code,
            headers=response_headers,
            body=body,
            error=None,
        )
    except Exception as exc:  # pylint: disable=broad-except
        return HttpClientResponse(status=None, headers={}, body=None, error=str(exc))


@app.post("/api/curl-head-probe", response_model=CurlHeadProbeResponse)
async def run_curl_head_probe(payload: CurlHeadProbeRequest) -> CurlHeadProbeResponse:
    """Perform a curl -I style HEAD probe via the backend and return redirects/headers."""
    print(f"run_curl_head_probe called with payload: {payload}")
    headers = dict(payload.headers or {})

    try:
        def _perform_request() -> requests.Response:
            request_kwargs: dict[str, Any] = {
                "method": "HEAD",
                "url": str(payload.url),
                "headers": headers,
                "allow_redirects": payload.follow_redirects,
            }

            return requests.request(**request_kwargs)

        response = await run_in_threadpool(_perform_request)

        redirects: list[dict[str, Any]] = []
        for hop in response.history:
            redirects.append(
                {
                    "status": hop.status_code,
                    "location": hop.headers.get("location"),
                    "url": hop.headers.get("location") or hop.url,
                }
            )

        response_headers = {k: v for k, v in response.headers.items()}
        body_preview = response.text[:500] if response.text else ""

        return CurlHeadProbeResponse(
            status=response.status_code,
            headers=response_headers,
            redirects=redirects,
            final_url=response.url,
            raw_response=body_preview,
            error=None,
        )
    except Exception as exc:  # pylint: disable=broad-except
        return CurlHeadProbeResponse(
            status=None,
            headers={},
            redirects=[],
            final_url=None,
            raw_response=None,
            error=str(exc),
        )


@app.post("/api/v2/migrations/run-step")
async def enqueue_migration_step(payload: RunStepRequest) -> dict[str, Any]:
    """
    Production-ready counterpart to the dev-only Vite middleware.
    Creates/resets a migration_step and enqueues a job record for the worker.
    """

    if not payload.migrationId:
        raise HTTPException(status_code=400, detail="migrationId is required")
    if not payload.agentName:
        raise HTTPException(status_code=400, detail="agentName is required")
    if not payload.stepId and not payload.stepName:
        raise HTTPException(status_code=400, detail="stepId or stepName is required")

    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            # Ensure migration exists and mark as processing
            cur.execute("SELECT id FROM public.migrations WHERE id = %s", (payload.migrationId,))
            migration_row = cur.fetchone()
            if not migration_row:
                raise HTTPException(status_code=404, detail="Migration not found")

            cur.execute(
                "UPDATE public.migrations SET status = 'processing' WHERE id = %s RETURNING id",
                (payload.migrationId,),
            )
            cur.fetchone()

            # Try to find existing step by workflow_step_id or id::text
            step_row: Optional[dict[str, Any]] = None
            if payload.stepId:
                cur.execute(
                    """
                    SELECT id, workflow_step_id
                    FROM public.migration_steps
                    WHERE migration_id = %s AND (workflow_step_id = %s OR id::text = %s)
                    LIMIT 1
                    """,
                    (payload.migrationId, payload.stepId, payload.stepId),
                )
                step_row = cur.fetchone()

            if step_row:
                cur.execute(
                    """
                    UPDATE public.migration_steps
                    SET status = 'pending',
                        status_message = NULL,
                        result = NULL,
                        workflow_step_id = COALESCE(%s, workflow_step_id),
                        name = COALESCE(%s, name),
                        updated_at = now()
                    WHERE id = %s
                    RETURNING id, workflow_step_id
                    """,
                    (payload.stepId, payload.stepName, step_row["id"]),
                )
                step_row = cur.fetchone()
            else:
                workflow_step_id = payload.stepId or (payload.stepName or "").lower().replace(" ", "-") or "step"
                step_name = payload.stepName or payload.stepId or "Unnamed step"
                cur.execute(
                    """
                    INSERT INTO public.migration_steps (migration_id, workflow_step_id, name, status)
                    VALUES (%s, %s, %s, 'pending')
                    RETURNING id, workflow_step_id
                    """,
                    (payload.migrationId, workflow_step_id, step_name),
                )
                step_row = cur.fetchone()

            if not step_row:
                raise HTTPException(status_code=500, detail="Failed to create migration step")

            # Enqueue job
            cur.execute(
                """
                INSERT INTO public.jobs (step_id, payload, status)
                VALUES (%s, %s, 'pending')
                RETURNING id
                """,
                (step_row["id"], payload.model_dump()),
            )
            job_row = cur.fetchone()

            conn.commit()

            return {
                "jobId": job_row["id"] if job_row else None,
                "stepId": step_row["workflow_step_id"],
                "stepRowId": step_row["id"],
                "message": "Agent execution has been enqueued",
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _cli(url: str) -> int:
    """Provide a clear CLI notice that legacy agents are no longer available."""

    print(LEGACY_MESSAGE, file=sys.stderr)
    return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Celion legacy agent placeholder")
    parser.add_argument("url", nargs="?", help="Basis-URL des Zielsystems")
    args = parser.parse_args()

    if args.url:
        raise SystemExit(_cli(args.url))

    print(LEGACY_MESSAGE, file=sys.stderr)
    raise SystemExit(1)
