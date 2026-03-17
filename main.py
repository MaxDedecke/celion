"""Celion FastAPI entry point now providing legacy notices only."""
# pyright: reportMissingImports=false

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone, date, timedelta
from typing import Any, Dict, Optional, Union

import os

import psycopg
import psycopg.rows
import requests
from fastapi import FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from starlette.concurrency import run_in_threadpool
import pika
import aio_pika
import asyncio
from collections import defaultdict
from uuid import UUID
from decimal import Decimal
import neo4j
from openai import OpenAI
from passlib.context import CryptContext


LEGACY_MESSAGE = "The legacy Python-based agents have been removed in favor of the frontend implementation."

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


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

app = FastAPI(title="Celion Agent Service", version="1.0.0")

# CORS configuration
allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "*")
allowed_origins = allowed_origins_env.split(",") if allowed_origins_env != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count"],
)


def publish_to_rabbitmq(job_id: int):
    """Publish a job ID to the RabbitMQ task queue."""
    try:
        rabbitmq_host = os.getenv("RABBITMQ_HOST", "localhost")
        rabbitmq_user = os.getenv("RABBITMQ_DEFAULT_USER", "guest")
        rabbitmq_pass = os.getenv("RABBITMQ_DEFAULT_PASS", "guest")
        credentials = pika.PlainCredentials(rabbitmq_user, rabbitmq_pass)
        connection = pika.BlockingConnection(pika.ConnectionParameters(host=rabbitmq_host, credentials=credentials))
        channel = connection.channel()

        queue_name = 'migration_tasks'
        channel.queue_declare(queue=queue_name, durable=True)

        message = json.dumps({'job_id': str(job_id)})
        channel.basic_publish(
            exchange='',
            routing_key=queue_name,
            body=message,
            properties=pika.BasicProperties(
                delivery_mode=2,  # make message persistent
            ))
        print(f" [x] Sent job '{job_id}' to RabbitMQ")
        connection.close()
    except Exception as e:
        # If RabbitMQ fails, we don't want to fail the whole request,
        # but we should log it. The DB-polling worker could still pick it up.
        print(f" [!] Failed to send job '{job_id}' to RabbitMQ: {e}", file=sys.stderr)


# --- WebSockets & Event Streaming ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, websocket: WebSocket, migration_id: str):
        await websocket.accept()
        self.active_connections[migration_id].append(websocket)

    def disconnect(self, websocket: WebSocket, migration_id: str):
        if migration_id in self.active_connections:
            if websocket in self.active_connections[migration_id]:
                self.active_connections[migration_id].remove(websocket)
            if not self.active_connections[migration_id]:
                del self.active_connections[migration_id]

    async def broadcast_to_migration(self, migration_id: str, message: dict):
        if migration_id in self.active_connections:
            connections_to_remove = []
            for connection in self.active_connections[migration_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    connections_to_remove.append(connection)
            for conn in connections_to_remove:
                self.disconnect(conn, migration_id)

manager = ConnectionManager()

async def rabbitmq_listener():
    rabbitmq_host = os.getenv("RABBITMQ_HOST", "localhost")
    rabbitmq_user = os.getenv("RABBITMQ_DEFAULT_USER", "guest")
    rabbitmq_pass = os.getenv("RABBITMQ_DEFAULT_PASS", "guest")
    
    connection = None
    for _ in range(10):
        try:
            connection = await aio_pika.connect_robust(
                f"amqp://{rabbitmq_user}:{rabbitmq_pass}@{rabbitmq_host}/"
            )
            print("Successfully connected to aio-pika for WebSockets.")
            break
        except Exception as e:
            print(f"Waiting for RabbitMQ for WebSockets... {e}")
            await asyncio.sleep(5)
            
    if not connection:
        print("Failed to connect to RabbitMQ for WebSockets after 10 attempts.")
        return

    async with connection:
        channel = await connection.channel()
        exchange = await channel.declare_exchange('celion.events', aio_pika.ExchangeType.TOPIC, durable=True)
        
        # Exclusive queue that dies when the server stops
        queue = await channel.declare_queue(exclusive=True)
        await queue.bind(exchange, routing_key='migration.#')

        async with queue.iterator() as queue_iter:
            async for message in queue_iter:
                async with message.process():
                    try:
                        data = json.loads(message.body.decode())
                        migration_id = data.get('migration_id')
                        if migration_id:
                            await manager.broadcast_to_migration(migration_id, data)
                    except Exception as e:
                        print(f"Error processing websocket event: {e}")

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(rabbitmq_listener())

@app.websocket("/api/v1/ws/migrations/{migration_id}")
async def websocket_endpoint(websocket: WebSocket, migration_id: str):
    await manager.connect(websocket, migration_id)
    try:
        while True:
            # Keep connection open, client doesn't need to send data
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, migration_id)


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

def _get_llm_settings(conn: psycopg.Connection):
    """Fetches the latest LLM settings from the database."""
    with conn.cursor() as cur:
        cur.execute("SELECT provider, model, base_url, api_key FROM public.llm_settings ORDER BY updated_at DESC LIMIT 1")
        settings = cur.fetchone()
        
        # If no settings in DB, try environment variables
        if not settings:
            api_key = os.environ.get("OPENAI_API_KEY")
            if not api_key:
                return None
            return {
                "provider": "openai",
                "model": os.environ.get("OPENAI_MODEL", "gpt-4o"),
                "base_url": None,
                "api_key": api_key
            }
            
        return settings


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


class SyncUserPayload(BaseModel):
    """Payload for syncing a user (from Keycloak or other sources)."""
    id: str
    email: str
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

    hashed_password = pwd_context.hash(payload.password)
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
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

        if not user_row or not pwd_context.verify(payload.password, user_row.get("password")):
            raise HTTPException(status_code=401, detail="Ungültige Zugangsdaten")

        return _serialize_user_row(user_row)
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive catch for DB errors
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/users/sync")
async def sync_user(payload: SyncUserPayload) -> dict[str, Any]:
    """
    Synchronize a user to the database.
    This function handles new users and gracefully merges users from Keycloak
    who may already exist in the database with a different ID but the same email.
    """
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
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
        print(f"Error syncing user: {exc}")
        raise HTTPException(status_code=500, detail="Failed to sync user.") from exc


class DashboardStats(BaseModel):
    total_migrations: int
    completed_migrations: int
    total_objects_migrated: int
    avg_automation_rate: float
    data_reliability_score: float
    vendor_lockins_prevented: int
    activity_graph: list[dict[str, Any]]
    total_steps_executed: int = 0


@app.get("/api/stats/dashboard", response_model=DashboardStats)
async def get_dashboard_stats():
    """Fetch aggregated statistics for the dashboard."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            # 1. Real-time counts from migrations table (current state)
            cur.execute("SELECT count(*) as count FROM public.migrations")
            total_migrations = cur.fetchone()["count"]

            cur.execute("SELECT count(*) as count FROM public.migrations WHERE status = 'completed' AND current_step >= 10")
            completed_migrations = cur.fetchone()["count"]

            # 2. Aggregated totals from global_stats (historical / global)
            cur.execute("""
                SELECT 
                    SUM(steps_completed) as total_steps,
                    SUM(objects_migrated) as total_objects,
                    SUM(agent_success_count) as success_agents,
                    SUM(agent_total_count) as total_agents,
                    SUM(reconciliation_accuracy_sum) as accuracy_sum,
                    SUM(reconciliation_count) as accuracy_count
                FROM public.global_stats
            """)
            global_totals = cur.fetchone()
            
            total_objects_migrated = global_totals["total_objects"] or 0
            total_steps_global = global_totals["total_steps"] or 0
            
            # AI Automation Rate: (Success / Total)
            automation_rate = 87.5 # Default fallback
            if global_totals["total_agents"] and global_totals["total_agents"] > 0:
                automation_rate = (global_totals["success_agents"] / global_totals["total_agents"]) * 100.0
            
            # Data Reliability: Average accuracy from reconciliation
            reliability_score = 98.2 # Default fallback
            if global_totals["accuracy_count"] and global_totals["accuracy_count"] > 0:
                reliability_score = (global_totals["accuracy_sum"] / global_totals["accuracy_count"]) * 100.0

            # 3. Activity Graph (Last 30 days from global_stats)
            cur.execute("""
                SELECT 
                    day, 
                    steps_completed as count 
                FROM public.global_stats 
                WHERE day > CURRENT_DATE - interval '30 days'
                ORDER BY day ASC
            """)
            graph_rows = cur.fetchall()
            graph_map = {row["day"].isoformat(): row["count"] for row in graph_rows}
            
            activity_list = []
            now_dt = datetime.now()
            for i in range(29, -1, -1):
                d = (now_dt - timedelta(days=i)).date()
                iso = d.isoformat()
                activity_list.append({
                    "date": d.strftime("%d.%m."),
                    "fullDate": iso,
                    "steps": int(graph_map.get(iso, 0))
                })

            return DashboardStats(
                total_migrations=total_migrations,
                completed_migrations=completed_migrations,
                total_objects_migrated=total_objects_migrated,
                avg_automation_rate=round(automation_rate, 1),
                data_reliability_score=round(reliability_score, 1),
                vendor_lockins_prevented=completed_migrations,
                activity_graph=activity_list,
                total_steps_executed=total_steps_global # We'll need to add this to the model
            )
    except Exception as exc:
        print(f"Error fetching dashboard stats: {exc}")
        return DashboardStats(
            total_migrations=0,
            completed_migrations=0,
            total_objects_migrated=0,
            avg_automation_rate=0.0,
            data_reliability_score=0.0,
            vendor_lockins_prevented=0,
            activity_graph=[]
        )


@app.get("/api/projects", response_model=list[Project])
async def get_projects(user_id: Optional[str] = None, name: Optional[str] = None) -> list[Project]:
    """Fetch projects where user is owner or member."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            if name:
                cur.execute(
                    "SELECT id, name, description, created_at FROM public.projects WHERE name = %s",
                    (name,),
                )
            elif user_id:
                # Fetch projects where user is owner OR member via project_members
                cur.execute(
                    """
                    SELECT DISTINCT p.id, p.name, p.description, p.created_at 
                    FROM public.projects p
                    LEFT JOIN public.project_members pm ON pm.project_id = p.id
                    WHERE p.user_id = %s OR pm.user_id = %s
                    ORDER BY p.created_at DESC
                    """,
                    (user_id, user_id),
                )
            else:
                cur.execute(
                    "SELECT id, name, description, created_at FROM public.projects ORDER BY created_at DESC"
                )
            project_rows = cur.fetchall()
            projects = []
            for row in project_rows:
                try:
                    created_at_str = ""
                    if isinstance(row["created_at"], (datetime, date)):
                        created_at_str = row["created_at"].isoformat()
                    else:
                        created_at_str = str(row["created_at"]) if row["created_at"] else ""
                        
                    projects.append(Project(
                        id=str(row["id"]),
                        name=row["name"],
                        description=row["description"],
                        created_at=created_at_str,
                    ))
                except Exception as row_err:
                    print(f"Error serializing project row {row.get('id')}: {row_err}")
                    continue
            return projects
    except Exception as exc:
        print(f"Error fetching projects: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch projects.") from exc


@app.get("/api/projects/{id}", response_model=Project)
async def get_project(id: str) -> Project:
    """Fetch a single project from the database."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, description, created_at FROM public.projects WHERE id = %s",
                (id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Project not found.")

            return Project(
                id=str(row["id"]),
                name=row["name"],
                description=row["description"],
                created_at=row["created_at"].isoformat(),
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching project: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch project.") from exc


class CreateProjectPayload(BaseModel):
    """Pydantic model for creating a project."""
    name: str
    description: Optional[str] = None
    user_id: str


class UpdateProjectPayload(BaseModel):
    """Pydantic model for updating a project."""
    name: Optional[str] = None
    description: Optional[str] = None


class Neo4jQueryPayload(BaseModel):
    query: str
    params: Optional[Dict[str, Any]] = {}


class Neo4jVectorSearchPayload(BaseModel):
    migration_id: str
    query_text: str
    limit: Optional[int] = 5
    source_system: Optional[str] = None


@app.post("/api/projects", response_model=Project)
async def create_project(payload: CreateProjectPayload) -> Project:
    """Create a new project and automatically add the creator as owner."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            # Create the project
            cur.execute(
                """
                INSERT INTO public.projects (name, description, user_id)
                VALUES (%s, %s, %s)
                RETURNING id, name, description, created_at
                """,
                (payload.name, payload.description, payload.user_id),
            )
            row = cur.fetchone()

            if not row:
                raise HTTPException(status_code=500, detail="Failed to create project.")

            project_id = str(row["id"])

            # Automatically add creator as owner in project_members
            cur.execute(
                """
                INSERT INTO public.project_members (project_id, user_id, role)
                VALUES (%s, %s, 'owner')
                ON CONFLICT (project_id, user_id) DO NOTHING
                """,
                (project_id, payload.user_id),
            )

            conn.commit()

            return Project(
                id=project_id,
                name=row["name"],
                description=row["description"],
                created_at=row["created_at"].isoformat(),
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error creating project: {exc}")
        raise HTTPException(status_code=500, detail="Failed to create project.") from exc


@app.patch("/api/projects/{id}", response_model=Project)
async def update_project(id: str, payload: UpdateProjectPayload) -> Project:
    """Update a project by id."""
    if not id:
        raise HTTPException(status_code=400, detail="Project id is required.")

    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            updates: list[str] = []
            params: list[Any] = []
            
            payload_dict = payload.model_dump(exclude_none=True)
            for field, value in payload_dict.items():
                updates.append(f"{field} = %s")
                params.append(value)
            
            if not updates:
                raise HTTPException(status_code=400, detail="No fields to update.")
            
            updates.append("updated_at = now()")
            params.append(id)
            
            query = f"""
                UPDATE public.projects
                SET {", ".join(updates)}
                WHERE id = %s
                RETURNING id, name, description, created_at
            """
            
            cur.execute(query, tuple(params))
            row = cur.fetchone()
            conn.commit()
            
            if not row:
                raise HTTPException(status_code=404, detail="Project not found.")
            
            return Project(
                id=str(row["id"]),
                name=row["name"],
                description=row["description"],
                created_at=row["created_at"].isoformat(),
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error updating project: {exc}")
        raise HTTPException(status_code=500, detail="Failed to update project.") from exc


@app.delete("/api/projects/{id}")
async def delete_project(id: str) -> dict[str, str]:
    """Delete a project and all related records, including Neo4j data for migrations."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT id FROM public.projects WHERE id = %s", (id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Project not found.")

            # Get all migration IDs associated with this project to clean up Neo4j
            cur.execute("SELECT id FROM public.migrations WHERE project_id = %s", (id,))
            migration_ids = [str(row["id"]) for row in cur.fetchall()]

            # Delete Neo4j data for each migration
            for mig_id in migration_ids:
                try:
                    await _delete_neo4j_data(mig_id)
                except Exception as neo_err:
                    print(f"Warning: Failed to delete Neo4j data for migration {mig_id}: {neo_err}")

            # Delete project (cascades to project_members, migrations, and other related PG tables)
            cur.execute("DELETE FROM public.projects WHERE id = %s", (id,))
            conn.commit()
            
            return {"message": f"Project {id} and its {len(migration_ids)} migrations deleted successfully."}
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error deleting project: {exc}")
        raise HTTPException(status_code=500, detail="Failed to delete project.") from exc


class DataSourceProject(BaseModel):
    project_id: str

@app.get("/api/data_source_projects", response_model=list[DataSourceProject])
async def get_data_source_projects(data_source_id: Optional[str] = None) -> list[DataSourceProject]:
    """Fetch data source to project assignments."""
    data_source_id = _strip_eq_prefix(data_source_id)
    
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            query = "SELECT project_id FROM public.data_source_projects"
            params = []

            if data_source_id:
                query += " WHERE data_source_id = %s"
                params.append(data_source_id)

            cur.execute(query, tuple(params))
            rows = cur.fetchall()
            return [{"project_id": str(row['project_id'])} for row in rows]
    except Exception as exc:
        print(f"Error fetching data source projects: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch data source projects.") from exc


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
    scope_config: Optional[dict] = None
    workflow_state: Optional[dict] = None
    progress: Optional[float] = 0.0
    current_step: int = 0
    step_status: str = "idle"
    consultant_status: str = "idle"
    status: Optional[str] = "not_started"
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


class MigrationStep(BaseModel):
    """Pydantic model for a migration step."""
    id: str
    migration_id: str
    workflow_step_id: str
    name: str
    status: str
    status_message: Optional[str] = None
    result: Optional[dict] = None
    created_at: str
    updated_at: Optional[str] = None


class MigrationChatMessage(BaseModel):
    """Pydantic model for a migration chat message."""
    id: str
    migration_id: str
    role: str
    content: str
    step_number: Optional[int] = None
    created_at: str


class CreateMigrationChatMessagePayload(BaseModel):
    """Pydantic model for creating a migration chat message."""
    role: str
    content: str
    step_number: Optional[int] = None


@app.get("/api/migration_steps", response_model=list[MigrationStep])
async def get_migration_steps(
    migration_id: str,
) -> list[MigrationStep]:
    """Fetch all steps for a given migration from the database."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            
            cur.execute(
                "SELECT id, migration_id, workflow_step_id, name, status, status_message, result, created_at, updated_at FROM public.migration_steps WHERE migration_id = %s ORDER BY created_at ASC",
                (migration_id,),
            )
            step_rows = cur.fetchall()

            steps = [
                MigrationStep(
                    id=str(row["id"]),
                    migration_id=str(row["migration_id"]),
                    workflow_step_id=row["workflow_step_id"],
                    name=row["name"],
                    status=row["status"],
                    status_message=row["status_message"],
                    result=row["result"],
                    created_at=row["created_at"].isoformat(),
                    updated_at=row["updated_at"].isoformat() if row["updated_at"] else None,
                )
                for row in step_rows
            ]
            
            return steps
            
    except Exception as exc:
        print(f"Error fetching migration steps: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch migration steps.") from exc


@app.get("/api/migrations/{id}/chat", response_model=list[MigrationChatMessage])
async def get_migration_chat_messages(id: str) -> list[MigrationChatMessage]:
    """Fetch all chat messages for a given migration."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, migration_id, role, content, step_number, created_at FROM public.migration_chat_messages WHERE migration_id = %s ORDER BY created_at ASC",
                (id,),
            )
            chat_rows = cur.fetchall()

            messages = [
                MigrationChatMessage(
                    id=str(row["id"]),
                    migration_id=str(row["migration_id"]),
                    role=row["role"],
                    content=row["content"],
                    step_number=row["step_number"],
                    created_at=row["created_at"].isoformat(),
                )
                for row in chat_rows
            ]
            return messages
    except Exception as exc:
        print(f"Error fetching migration chat messages: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch migration chat messages.") from exc


class AnswerAgentRequest(BaseModel):
    """Payload for asking the AI consultant a question."""
    content: str

@app.post("/api/migrations/{id}/chat/answer")
async def ask_consultant(id: str, payload: AnswerAgentRequest) -> dict[str, Any]:
    """Ask the AI consultant or onboarding agent a question."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            # 0. Check current step
            cur.execute("SELECT current_step FROM public.migrations WHERE id = %s", (id,))
            mig_row = cur.fetchone()
            if not mig_row:
                raise HTTPException(status_code=404, detail="Migration not found.")
            
            current_step = mig_row["current_step"]

            # 1. Save user message
            cur.execute(
                """
                INSERT INTO public.migration_chat_messages (migration_id, role, content)
                VALUES (%s, 'user', %s)
                RETURNING id
                """,
                (id, payload.content),
            )
            user_msg_id = cur.fetchone()["id"]

            # Broadcast user message immediately
            import asyncio
            asyncio.create_task(manager.broadcast_to_migration(id, {
                "migration_id": id,
                "type": "chat_message_added",
                "data": {
                    "role": "user",
                    "content": payload.content,
                    "step_number": None
                }
            }))

            # 2. Fetch context (Step Results)
            step_results = {"step_1": [], "step_2": [], "step_3": [], "step_4": [], "step_5": [], "step_6": []}
            cur.execute("SELECT * FROM public.step_1_results WHERE migration_id = %s", (id,))
            step_results["step_1"] = [dict(row) for row in cur.fetchall()]
            cur.execute("SELECT * FROM public.step_2_results WHERE migration_id = %s", (id,))
            step_results["step_2"] = [dict(row) for row in cur.fetchall()]
            cur.execute("SELECT * FROM public.step_3_results WHERE migration_id = %s", (id,))
            step_results["step_3"] = [dict(row) for row in cur.fetchall()]
            cur.execute("SELECT * FROM public.step_4_results WHERE migration_id = %s", (id,))
            step_results["step_4"] = [dict(row) for row in cur.fetchall()]
            cur.execute("SELECT * FROM public.step_5_results WHERE migration_id = %s", (id,))
            step_results["step_5"] = [dict(row) for row in cur.fetchall()]
            cur.execute("SELECT * FROM public.step_6_results WHERE migration_id = %s", (id,))
            step_results["step_6"] = [dict(row) for row in cur.fetchall()]

            # 3. Fetch History (last 10 messages for follow-ups)
            cur.execute(
                """
                SELECT role, content FROM public.migration_chat_messages 
                WHERE migration_id = %s 
                AND role IN ('user', 'assistant')
                ORDER BY created_at DESC LIMIT 10
                """,
                (id,)
            )
            history = [{"role": row["role"], "content": row["content"]} for row in reversed(cur.fetchall())]

            # 4. Enqueue Job
            agent_name = "runIntroductionAgent" if current_step == 0 else "runAnswerAgent"
            agent_params = {
                "userMessage": payload.content,
                "context": {
                    "history": history
                }
            }
            if current_step != 0:
                agent_params["context"]["stepResults"] = step_results
            else:
                # For onboarding, include name
                cur.execute("SELECT name FROM public.migrations WHERE id = %s", (id,))
                name_row = cur.fetchone()
                if name_row:
                    agent_params["context"]["migrationName"] = name_row["name"]

            cur.execute(
                """
                INSERT INTO public.jobs (step_id, payload, status)
                VALUES (NULL, %s, 'pending')
                RETURNING id
                """,
                (json_dumps({
                    "migrationId": id,
                    "agentName": agent_name,
                    "agentParams": agent_params
                }),),
            )
            job_row = cur.fetchone()
            publish_to_rabbitmq(job_row["id"])
            
            conn.commit()
            return {"message": "Anfrage wurde übermittelt.", "jobId": job_row["id"]}

    except Exception as exc:
        print(f"Error enqueuing agent job: {exc}")
        raise HTTPException(status_code=500, detail="Fehler beim Senden der Anfrage.")


@app.post("/api/migrations/{id}/chat", response_model=MigrationChatMessage)
async def create_migration_chat_message(id: str, payload: CreateMigrationChatMessagePayload) -> MigrationChatMessage:
    """Create a new chat message for a given migration."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.migration_chat_messages (migration_id, role, content, step_number)
                VALUES (%s, %s, %s, %s)
                RETURNING id, migration_id, role, content, step_number, created_at
                """,
                (id, payload.role, payload.content, payload.step_number),
            )
            row = cur.fetchone()
            conn.commit()

            if not row:
                raise HTTPException(status_code=500, detail="Failed to create chat message.")

            # Broadcast message immediately
            import asyncio
            asyncio.create_task(manager.broadcast_to_migration(id, {
                "migration_id": id,
                "type": "chat_message_added",
                "data": {
                    "role": row["role"],
                    "content": row["content"],
                    "step_number": row["step_number"]
                }
            }))

            return MigrationChatMessage(
                id=str(row["id"]),
                migration_id=str(row["migration_id"]),
                role=row["role"],
                content=row["content"],
                step_number=row["step_number"],
                created_at=row["created_at"].isoformat(),
            )
    except Exception as exc:
        print(f"Error creating migration chat message: {exc}")
        raise HTTPException(status_code=500, detail="Failed to create migration chat message.") from exc


class MappingChatMessage(BaseModel):
    """Pydantic model for a mapping chat message."""
    id: str
    migration_id: str
    role: str
    content: str
    created_at: str


class CreateMappingChatMessagePayload(BaseModel):
    """Pydantic model for creating a mapping chat message."""
    role: str
    content: str


@app.get("/api/migrations/{id}/mapping-chat", response_model=list[MappingChatMessage])
async def get_mapping_chat_messages(id: str) -> list[MappingChatMessage]:
    """Fetch all mapping chat messages for a given migration."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, migration_id, role, content, created_at FROM public.mapping_chat_messages WHERE migration_id = %s ORDER BY created_at ASC",
                (id,),
            )
            chat_rows = cur.fetchall()

            messages = [
                MappingChatMessage(
                    id=str(row["id"]),
                    migration_id=str(row["migration_id"]),
                    role=row["role"],
                    content=row["content"],
                    created_at=row["created_at"].isoformat(),
                )
                for row in chat_rows
            ]
            return messages
    except Exception as exc:
        print(f"Error fetching mapping chat messages: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch mapping chat messages.") from exc


class MappingRule(BaseModel):
    id: str
    migration_id: str
    source_system: str
    source_object: str
    source_property: Optional[str] = None
    target_system: str
    target_object: str
    target_property: Optional[str] = None
    note: Optional[str] = None
    rule_type: str # 'MAP', 'POLISH', 'SUMMARY', 'IGNORE', 'ENHANCE'
    enhancements: Optional[list[str]] = []
    created_at: str

class CreateMappingRulePayload(BaseModel):
    source_system: str
    source_object: str
    source_property: str
    target_system: str
    target_object: str
    target_property: str
    note: Optional[str] = None
    rule_type: str
    enhancements: Optional[list[str]] = []

class UpdateMappingRulePayload(BaseModel):
    note: Optional[str] = None
    rule_type: Optional[str] = None
    enhancements: Optional[list[str]] = None

@app.get("/api/migrations/{id}/mapping-rules", response_model=list[MappingRule])
async def get_mapping_rules(id: str) -> list[MappingRule]:
    """Fetch all mapping rules for a given migration."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM public.mapping_rules WHERE migration_id = %s ORDER BY created_at DESC",
                (id,),
            )
            rows = cur.fetchall()
            return [
                MappingRule(
                    id=str(row["id"]),
                    migration_id=str(row["migration_id"]),
                    source_system=row["source_system"],
                    source_object=row["source_object"],
                    source_property=row.get("source_property"),
                    target_system=row["target_system"],
                    target_object=row["target_object"],
                    target_property=row.get("target_property"),
                    note=row.get("note"),
                    rule_type=row["rule_type"],
                    enhancements=row.get("enhancements") or [],
                    created_at=row["created_at"].isoformat(),
                )
                for row in rows
            ]
    except Exception as exc:
        print(f"Error fetching mapping rules: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch mapping rules.") from exc

@app.post("/api/migrations/{id}/mapping-rules", response_model=MappingRule)
async def create_mapping_rule(id: str, payload: CreateMappingRulePayload) -> MappingRule:
    """Create a new mapping rule."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.mapping_rules 
                (migration_id, source_system, source_object, source_property, target_system, target_object, target_property, note, rule_type, enhancements)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    id, 
                    payload.source_system, 
                    payload.source_object, 
                    payload.source_property,
                    payload.target_system, 
                    payload.target_object, 
                    payload.target_property,
                    payload.note,
                    payload.rule_type,
                    json.dumps(payload.enhancements) if payload.enhancements is not None else '[]'
                ),
            )
            row = cur.fetchone()
            conn.commit()
            
            return MappingRule(
                id=str(row["id"]),
                migration_id=str(row["migration_id"]),
                source_system=row["source_system"],
                source_object=row["source_object"],
                source_property=row.get("source_property"),
                target_system=row["target_system"],
                target_object=row["target_object"],
                target_property=row.get("target_property"),
                note=row.get("note"),
                rule_type=row["rule_type"],
                enhancements=row.get("enhancements") or [],
                created_at=row["created_at"].isoformat(),
            )
    except Exception as exc:
        print(f"Error creating mapping rule: {exc}")
        raise HTTPException(status_code=500, detail="Failed to create mapping rule.") from exc

@app.patch("/api/migrations/{id}/mapping-rules/{rule_id}", response_model=MappingRule)
async def patch_mapping_rule(id: str, rule_id: str, payload: UpdateMappingRulePayload) -> MappingRule:
    """Update an existing mapping rule."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            updates = []
            params = []
            if payload.note is not None:
                updates.append("note = %s")
                params.append(payload.note)
            if payload.rule_type is not None:
                updates.append("rule_type = %s")
                params.append(payload.rule_type)
            if payload.enhancements is not None:
                updates.append("enhancements = %s")
                params.append(json.dumps(payload.enhancements))
            
            if not updates:
                raise HTTPException(status_code=400, detail="No fields to update.")
            
            query = f"UPDATE public.mapping_rules SET {', '.join(updates)} WHERE id = %s AND migration_id = %s RETURNING *"
            params.extend([rule_id, id])
            
            cur.execute(query, tuple(params))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Mapping rule not found.")
            
            conn.commit()
            return MappingRule(
                id=str(row["id"]),
                migration_id=str(row["migration_id"]),
                source_system=row["source_system"],
                source_object=row["source_object"],
                source_property=row.get("source_property"),
                target_system=row["target_system"],
                target_object=row["target_object"],
                target_property=row.get("target_property"),
                note=row.get("note"),
                rule_type=row["rule_type"],
                enhancements=row.get("enhancements") or [],
                created_at=row["created_at"].isoformat(),
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error updating mapping rule: {exc}")
        raise HTTPException(status_code=500, detail="Failed to update mapping rule.") from exc

@app.delete("/api/migrations/{id}/mapping-rules/{rule_id}")
async def delete_mapping_rule(id: str, rule_id: str) -> dict[str, str]:
    """Delete an existing mapping rule."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM public.mapping_rules WHERE id = %s AND migration_id = %s RETURNING id", (rule_id, id))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Mapping rule not found.")
            conn.commit()
            return {"message": "Mapping rule deleted successfully."}
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error deleting mapping rule: {exc}")
        raise HTTPException(status_code=500, detail="Failed to delete mapping rule.") from exc


def _filter_id_fields(schema: dict[str, Any]) -> dict[str, Any]:
    """Remove fields that look like IDs from the schema to focus mapping on content."""
    if not schema or "objects" not in schema:
        return schema
    
    id_suffixes = ("_id", "Id", "Guid", "Uuid", "_guid", "_uuid")
    id_exact = ("id", "uuid", "guid", "pk", "_id", "external_id")
    
    filtered_objects = []
    for obj in schema["objects"]:
        filtered_obj = obj.copy()
        if "fields" in obj:
            filtered_obj["fields"] = [
                f for f in obj["fields"] 
                if f.get("id", "").lower() not in id_exact and 
                not f.get("id", "").endswith(id_suffixes)
            ]
        filtered_objects.append(filtered_obj)
    
    return {**schema, "objects": filtered_objects}

@app.post("/api/migrations/{id}/mapping-chat", response_model=MappingChatMessage)
async def create_mapping_chat_message(id: str, payload: CreateMappingChatMessagePayload) -> MappingChatMessage:
    """Create a new mapping chat message for a given migration."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            # 1. Save user message
            cur.execute(
                """
                INSERT INTO public.mapping_chat_messages (migration_id, role, content)
                VALUES (%s, %s, %s)
                RETURNING id, migration_id, role, content, created_at
                """,
                (id, payload.role, payload.content),
            )
            row = cur.fetchone()
            
            # 2. Prepare Context for Agent
            # Current Mappings from Step 6
            cur.execute("SELECT raw_json FROM public.step_6_results WHERE migration_id = %s", (id,))
            step6_row = cur.fetchone()
            current_mappings = step6_row['raw_json'].get('mappings', []) if step6_row and step6_row['raw_json'] else []
            
            # Get Migration details (Source/Target Systems)
            cur.execute("SELECT source_system, target_system, scope_config FROM public.migrations WHERE id = %s", (id,))
            migration_info = cur.fetchone()
            source_system = migration_info["source_system"] if migration_info else None
            target_system = migration_info["target_system"] if migration_info else None
            scope_config = migration_info["scope_config"] if migration_info else {}
            execution_plan = scope_config.get("execution_plan") if scope_config else None

            # Load Schemas
            import re
            
            source_schema = {}
            if source_system:
                norm_source = "".join(re.findall(r"[a-z0-9]", source_system.lower()))
                source_path = os.path.join(os.getcwd(), "schemes", "objects", f"{norm_source}_objects.json")
                if os.path.exists(source_path):
                    with open(source_path, "r", encoding="utf-8") as f:
                        source_schema = _filter_id_fields(json.load(f))

            target_schema = {}
            if target_system:
                norm_target = "".join(re.findall(r"[a-z0-9]", target_system.lower()))
                target_path = os.path.join(os.getcwd(), "schemes", "objects", f"{norm_target}_objects.json")
                if os.path.exists(target_path):
                    with open(target_path, "r", encoding="utf-8") as f:
                        target_schema = _filter_id_fields(json.load(f))

            # Source Entities from Step 3
            cur.execute("SELECT entity_name as name, count FROM public.step_3_results WHERE migration_id = %s", (id,))
            user_related_terms = ['user', 'member', 'participant', 'assignee', 'owner', 'creator', 'author', 'collaborator']
            source_entities = [
                dict(r) for r in cur.fetchall() 
                if r['count'] > 0 and not any(term in r['name'].lower() for term in user_related_terms)
            ]
            
            # Target Entities (Try Step 4 writable_entities or fallback)
            cur.execute("SELECT writable_entities FROM public.step_4_results WHERE migration_id = %s", (id,))
            step4_row = cur.fetchone()
            target_entity_names = step4_row['writable_entities'] if step4_row and step4_row['writable_entities'] else []
            target_entities = [{"name": name} for name in target_entity_names]
            
            # History
            cur.execute(
                """
                SELECT role, content FROM public.mapping_chat_messages 
                WHERE migration_id = %s 
                ORDER BY created_at DESC LIMIT 10
                """,
                (id,)
            )
            history = [{"role": r["role"], "content": r["content"]} for r in reversed(cur.fetchall())]

            # 3. Fetch current migration step to decide which agent to run
            cur.execute("SELECT current_step, step_status FROM public.migrations WHERE id = %s", (id,))
            mig_row = cur.fetchone()
            current_step = mig_row["current_step"] if mig_row else 0
            step_status = mig_row["step_status"] if mig_row else "idle"

            # 4. Enqueue Job for Rules Agent
            if payload.role == 'user':
                # Use Enhancement Agent if we are at step 5 (Enhancement)
                # If we are at step 4, we use Mapping Rules Agent (even if completed due to planning phase)
                is_enhancement_phase = (current_step == 5)
                agent_name = "runEnhancementRules" if is_enhancement_phase else "runMappingRules"
                
                # Fetch current rules for context
                cur.execute("SELECT * FROM public.mapping_rules WHERE migration_id = %s", (id,))
                current_rules = [dict(r) for r in cur.fetchall()]

                agent_params = {
                    "userMessage": payload.content,
                    "context": {
                        "sourceEntities": source_entities,
                        "sourceSchema": source_schema,
                        "history": history,
                        "migrationId": id,
                        "executionPlan": execution_plan
                    }
                }

                if is_enhancement_phase:
                    # Filter only MAP rules for enhancement context
                    agent_params["context"]["currentEnhancements"] = [r for r in current_rules if r.get("rule_type") == 'MAP']
                else:
                    agent_params["context"]["currentMappings"] = current_mappings
                    agent_params["context"]["targetEntities"] = target_entities
                    agent_params["context"]["targetSchema"] = target_schema

                cur.execute(
                    """
                    INSERT INTO public.jobs (step_id, payload, status)
                    VALUES (NULL, %s, 'pending')
                    RETURNING id
                    """,
                    (json_dumps({
                        "migrationId": id,
                        "agentName": agent_name,
                        "agentParams": agent_params
                    }),),
                )
                job_row = cur.fetchone()
                publish_to_rabbitmq(job_row["id"])
            
            conn.commit()

            if not row:
                raise HTTPException(status_code=500, detail="Failed to create mapping chat message.")

            return MappingChatMessage(
                id=str(row["id"]),
                migration_id=str(row["migration_id"]),
                role=row["role"],
                content=row["content"],
                created_at=row["created_at"].isoformat(),
            )
    except Exception as exc:
        print(f"Error creating mapping chat message: {exc}")
        raise HTTPException(status_code=500, detail="Failed to create mapping chat message.") from exc



class StepTriggerParams(BaseModel):
    agent_params: Optional[Dict[str, Any]] = None

@app.post("/api/migrations/{id}/action/{step}")
async def trigger_migration_step(id: str, step: int, params: Optional[StepTriggerParams] = None) -> dict[str, Any]:
    """Trigger a specific step in the migration process."""
    if not 1 <= step <= 8:
        raise HTTPException(status_code=400, detail="Step number must be between 1 and 8.")

    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            # 1. Update migration status and fetch details
            cur.execute(
                """
                UPDATE public.migrations
                SET current_step = %s, step_status = 'running', status = 'processing'
                WHERE id = %s
                RETURNING id, source_url, source_system, target_url, target_system, notes, workflow_state
                """,
                (step, id),
            )
            migration_row = cur.fetchone()
            if not migration_row:
                raise HTTPException(status_code=404, detail="Migration not found")

            # --- Workflow State Consistency ---
            # Remove nodes from workflow_state that correspond to the retried step or later steps.
            wf_state = migration_row.get("workflow_state") or {}
            if "nodes" in wf_state and isinstance(wf_state["nodes"], list):
                new_nodes = []
                step_map = {
                    "schema-discovery": 1,
                    "target-schema": 2,
                    "data-staging": 3,
                    "mapping-verification": 4,
                    "quality-enhancement": 5,
                    "data-transfer": 6,
                    "verification": 7,
                    "report": 8
                }
                
                for node in wf_state["nodes"]:
                     node_id = node.get("id", "")
                     keep = True
                     
                     # Check named IDs
                     if node_id in step_map:
                         if step_map[node_id] >= step:
                             keep = False
                     
                     # Check step-N IDs
                     elif node_id.startswith("step-"):
                         try:
                             node_step_num = int(node_id.split("-")[1])
                             if node_step_num >= step:
                                 keep = False
                         except ValueError:
                             pass
                     
                     if keep:
                         new_nodes.append(node)

                wf_state["nodes"] = new_nodes
                # Update workflow_state in DB
                cur.execute(
                    "UPDATE public.migrations SET workflow_state = %s WHERE id = %s",
                    (json.dumps(wf_state), id)
                )

            # 2. Create a migration_step record
            step_name = f"Step {step}"
            workflow_step_id = f"step-{step}"

            # --- Consistency Rollback ---
            # If we are re-running an earlier step, we must clear results of all subsequent steps
            # to maintain data integrity.
            # ONLY do this if we are not just providing input (i.e. params.agent_params is None)
            
            is_continuation = params is not None and params.agent_params is not None

            if not is_continuation:
                # 1. Clear structured results for steps >= this step
                if step <= 1:
                    cur.execute("DELETE FROM public.step_3_results WHERE migration_id = %s", (id,))
                if step <= 2:
                    cur.execute("DELETE FROM public.step_4_results WHERE migration_id = %s", (id,))
                if step <= 3:
                    cur.execute("DELETE FROM public.step_5_results WHERE migration_id = %s", (id,))
                if step <= 4:
                    cur.execute("DELETE FROM public.step_6_results WHERE migration_id = %s", (id,))
                
                # 2. Reset overall migration complexity if step 1 is retried
                if step <= 1:
                    cur.execute("UPDATE public.migrations SET complexity_score = 0 WHERE id = %s", (id,))

                # 3. Clear/Reset migration_steps for all steps >= current retry step
                cur.execute(
                    """
                    DELETE FROM public.migration_steps 
                    WHERE migration_id = %s 
                    AND workflow_step_id ~ '^step-[0-9]+$'
                    AND CAST(substring(workflow_step_id from 6) AS INTEGER) >= %s
                    """,
                    (id, step),
                )

                # 4. Clear chat messages from this step onwards
                # cur.execute(
                #     """
                #     DELETE FROM public.migration_chat_messages 
                #     WHERE migration_id = %s 
                #     AND step_number >= %s
                #     """,
                #     (id, step),
                # )

            # 5. Reset migration current_step if needed
            cur.execute(
                "UPDATE public.migrations SET current_step = %s WHERE id = %s",
                (step, id)
            )

            # 6. Create new pending step record
            cur.execute(
                """
                INSERT INTO public.migration_steps (migration_id, workflow_step_id, name, status)
                VALUES (%s, %s, %s, 'pending')
                ON CONFLICT (migration_id, workflow_step_id) DO UPDATE
                SET status = 'pending', status_message = NULL, result = NULL, updated_at = now()
                RETURNING id
                """,
                (id, workflow_step_id, step_name),
            )
            step_row = cur.fetchone()
            if not step_row:
                raise HTTPException(status_code=500, detail="Failed to create migration step.")
            
            step_id = step_row["id"]

            # 3. Enqueue job for the worker
            step_agent_mapping = {
                1: "runCapabilityDiscovery",
                2: "runTargetSchema",
                3: "runDataStaging",
                4: "runMappingVerification",
                5: "runQualityEnhancement",
                6: "runDataTransfer",
                7: "runVerification",
                8: "runReport",
            }
            agent_name = step_agent_mapping.get(step, "runCapabilityDiscovery")

            payload_base = {
                "migrationId": id,
                "stepId": str(step_id),
                "stepNumber": step,
                "agentName": agent_name,
            }

            agent_params = {
                "sourceUrl": migration_row["source_url"],
                "sourceExpectedSystem": migration_row["source_system"],
                "targetUrl": migration_row["target_url"],
                "targetExpectedSystem": migration_row["target_system"],
                "instructions": migration_row["notes"],
            }
            
            # Merge extra params if provided
            if params and params.agent_params:
                agent_params.update(params.agent_params)

            payload = {
                **payload_base,
                "agentParams": agent_params,
            }
            cur.execute(
                "INSERT INTO public.jobs (step_id, payload, status) VALUES (%s, %s, 'pending')",
                (step_id, json.dumps(payload)),
            )

            # We need to publish to RabbitMQ for EACH job created in this turn
            cur.execute("SELECT id FROM public.jobs WHERE step_id = %s AND status = 'pending'", (step_id,))
            job_rows = cur.fetchall()
            for job_row in job_rows:
                publish_to_rabbitmq(job_row["id"])
            
            conn.commit()

            return {
                "stepId": step_id,
                "message": f"Step {step} has been enqueued with {len(job_rows)} jobs",
            }
    except HTTPException:
        raise
    except Exception as exc:
        # Rollback in case of error
        with _get_db_connection() as conn:
            conn.rollback()
        # Revert status
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE public.migrations SET step_status = 'failed', status = 'paused' WHERE id = %s",
                (id,),
            )
            conn.commit()
        raise HTTPException(status_code=500, detail=str(exc)) from exc



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
    scope_config: Optional[dict] = None


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
                    out_connector, out_connector_detail, status, scope_config,
                    current_step, step_status
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0, 'idle')
                RETURNING id, name, source_system, target_system, source_url, target_url, in_connector, in_connector_detail, out_connector, out_connector_detail, objects_transferred, mapped_objects, project_id, notes, workflow_state, progress, current_step, step_status, consultant_status, status, created_at, updated_at, scope_config
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
                    "processing",
                    json.dumps(payload.scope_config) if payload.scope_config else None,
                ),
            )
            row = cur.fetchone()
            
            if not row:
                raise HTTPException(status_code=500, detail="Failed to create migration.")

            migration_id = str(row["id"])

            # 1. Create a dedicated onboarding step record
            cur.execute(
                """
                INSERT INTO public.migration_steps (migration_id, workflow_step_id, name, status)
                VALUES (%s, 'onboarding', 'Einrichtung', 'running')
                RETURNING id
                """,
                (migration_id,),
            )
            onboarding_step_id = cur.fetchone()["id"]

            # 2. Enqueue Job for Introduction
            cur.execute(
                """
                INSERT INTO public.jobs (step_id, payload, status)
                VALUES (%s, %s, 'pending')
                RETURNING id
                """,
                (onboarding_step_id, json_dumps({
                    "migrationId": migration_id,
                    "agentName": "runIntroductionAgent",
                    "agentParams": {
                        "userMessage": "Hallo! Ich möchte eine neue Migration starten.",
                        "context": {
                            "history": [],
                            "migrationName": payload.name
                        }
                    }
                }),),
            )
            job_row = cur.fetchone()
            if job_row:
                publish_to_rabbitmq(job_row["id"])

            conn.commit()

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
                scope_config=row["scope_config"],
                workflow_state=row["workflow_state"],
                progress=row["progress"],
                current_step=row["current_step"],
                step_status=row["step_status"],
                consultant_status=row["consultant_status"],
                status=row["status"],
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
    user_id: Optional[str] = None,
    limit: int = 15,
    offset: int = 0,
) -> list[Migration]:
    """Fetch migrations from the database with user-based visibility."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            
            base_select = "SELECT m.id, m.name, m.source_system, m.target_system, m.source_url, m.target_url, m.in_connector, m.in_connector_detail, m.out_connector, m.out_connector_detail, m.objects_transferred, m.mapped_objects, m.project_id, m.notes, m.scope_config, m.workflow_state, m.progress, m.current_step, m.step_status, m.consultant_status, m.status, m.created_at, m.updated_at FROM public.migrations m"
            
            conditions = []
            params = []
            
            # Handle project_id filter
            if project_id:
                if project_id == "is.null":
                    conditions.append("m.project_id IS NULL")
                    # For standalone migrations, only show user's own
                    if user_id:
                        conditions.append("m.user_id = %s")
                        params.append(user_id)
                elif project_id.startswith("eq."):
                    conditions.append("m.project_id = %s")
                    params.append(project_id.replace("eq.", ""))
                else:
                    conditions.append("m.project_id = %s")
                    params.append(project_id)
            elif user_id:
                # No project_id filter: show user's standalone migrations + migrations in projects they can access
                conditions.append("""(
                    (m.project_id IS NULL AND m.user_id = %s)
                    OR m.project_id IN (
                        SELECT p.id FROM public.projects p WHERE p.user_id = %s
                        UNION
                        SELECT pm.project_id FROM public.project_members pm WHERE pm.user_id = %s
                    )
                )""")
                params.extend([user_id, user_id, user_id])
            
            where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""
            
            count_query = f"SELECT COUNT(*) FROM public.migrations m{where_clause}"
            cur.execute(count_query, tuple(params))
            count_result = cur.fetchone()
            total_count = count_result['count'] if count_result else 0
            
            query = f"{base_select}{where_clause} ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC LIMIT %s OFFSET %s"
            params.extend([limit, offset])

            cur.execute(query, tuple(params))
            migration_rows = cur.fetchall()

            migrations = []
            for row in migration_rows:
                try:
                    # Robust date serialization
                    created_at_str = ""
                    if isinstance(row["created_at"], (datetime, date)):
                        created_at_str = row["created_at"].isoformat()
                    else:
                        created_at_str = str(row["created_at"]) if row["created_at"] else ""

                    updated_at_str = None
                    if row.get("updated_at"):
                        if isinstance(row["updated_at"], (datetime, date)):
                            updated_at_str = row["updated_at"].isoformat()
                        else:
                            updated_at_str = str(row["updated_at"])

                    migrations.append(Migration(
                        id=str(row["id"]),
                        name=row["name"],
                        source_system=row["source_system"],
                        target_system=row["target_system"],
                        source_url=row.get("source_url") or "",
                        target_url=row.get("target_url") or "",
                        in_connector=row.get("in_connector"),
                        in_connector_detail=row.get("in_connector_detail"),
                        out_connector=row.get("out_connector"),
                        out_connector_detail=row.get("out_connector_detail"),
                        objects_transferred=row.get("objects_transferred"),
                        mapped_objects=row.get("mapped_objects"),
                        project_id=str(row["project_id"]) if row.get("project_id") else None,
                        notes=row.get("notes"),
                        scope_config=row.get("scope_config"),
                        workflow_state=row.get("workflow_state"),
                        progress=float(row["progress"]) if row.get("progress") is not None else 0.0,
                        current_step=int(row["current_step"]) if row.get("current_step") is not None else 0,
                        step_status=row.get("step_status") or "idle",
                        consultant_status=row.get("consultant_status") or "idle",
                        status=row.get("status") or "not_started",
                        created_at=created_at_str,
                        updated_at=updated_at_str,
                    ))
                except Exception as row_err:
                    print(f"Error serializing migration row {row.get('id')}: {row_err}")
                    continue
            
            response.headers["X-Total-Count"] = str(total_count)
            return migrations
            
    except Exception as exc:
        print(f"Error fetching migrations: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch migrations.") from exc


@app.get("/api/migrations/{id}", response_model=Migration)
async def get_migration(id: str) -> Migration:
    """Fetch a single migration from the database."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, source_system, target_system, source_url, target_url, in_connector, in_connector_detail, out_connector, out_connector_detail, objects_transferred, mapped_objects, project_id, notes, scope_config, workflow_state, progress, current_step, step_status, consultant_status, status, created_at, updated_at FROM public.migrations WHERE id = %s",
                (id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Migration not found.")

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
                scope_config=row["scope_config"],
                workflow_state=row["workflow_state"],
                progress=row["progress"],
                current_step=row["current_step"],
                step_status=row["step_status"],
                consultant_status=row["consultant_status"],
                status=row["status"],
                created_at=row["created_at"].isoformat(),
                updated_at=row["updated_at"].isoformat() if row["updated_at"] else None,
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching migration: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch migration.") from exc


class UpdateMigrationPayload(BaseModel):
    """Pydantic model for updating a migration."""
    name: Optional[str] = None
    source_system: Optional[str] = None
    target_system: Optional[str] = None
    source_url: Optional[str] = None
    target_url: Optional[str] = None
    in_connector: Optional[str] = None
    in_connector_detail: Optional[str] = None
    out_connector: Optional[str] = None
    out_connector_detail: Optional[str] = None
    objects_transferred: Optional[str] = None
    mapped_objects: Optional[str] = None
    notes: Optional[str] = None
    scope_config: Optional[dict] = None
    workflow_state: Optional[dict] = None
    progress: Optional[int] = None

def _get_neo4j_driver():
    """Create a new Neo4j driver using environment variables."""
    uri = os.getenv("NEO4J_URI", "bolt://neo4j-db:7687")
    user = os.getenv("NEO4J_USER", "neo4j")
    password = os.getenv("NEO4J_PASSWORD", "password")
    return neo4j.GraphDatabase.driver(uri, auth=(user, password))


async def _duplicate_neo4j_data(old_id: str, new_id: str):
    """Clone all nodes and relationships from one migration to another in Neo4j."""
    driver = _get_neo4j_driver()
    try:
        with driver.session() as session:
            # 1. Fetch all nodes for the old migration
            result = session.run(
                "MATCH (n {migration_id: $oldId}) RETURN labels(n) as labels, properties(n) as props",
                oldId=old_id
            )
            nodes = list(result)
            
            # 2. Create new nodes for the new migration
            for record in nodes:
                labels = record["labels"]
                props = dict(record["props"])
                props["migration_id"] = str(new_id)
                
                # Dynamic label creation in Cypher
                label_str = ":".join([f"`{l}`" for l in labels])
                query = f"CREATE (n:{label_str}) SET n = $props"
                session.run(query, props=props)
            
            # 3. Fetch and duplicate relationships
            # Note: This assumes relationships only exist between nodes of the same migration
            rel_result = session.run(
                """
                MATCH (s {migration_id: $oldId})-[r]->(t {migration_id: $oldId})
                RETURN labels(s) as sLabels, s.external_id as sExt, 
                       labels(t) as tLabels, t.external_id as tExt, 
                       type(r) as relType, properties(r) as relProps
                """,
                oldId=old_id
            )
            
            for rel in rel_result:
                s_labels = ":".join([f"`{l}`" for l in rel["sLabels"]])
                t_labels = ":".join([f"`{l}`" for l in rel["tLabels"]])
                
                query = f"""
                    MATCH (s:{s_labels} {{external_id: $sExt, migration_id: $newId}})
                    MATCH (t:{t_labels} {{external_id: $tExt, migration_id: $newId}})
                    CREATE (s)-[r:`{rel["relType"]}`]->(t)
                    SET r = $relProps
                """
                session.run(query, sExt=rel["sExt"], tExt=rel["tExt"], newId=str(new_id), relProps=rel["relProps"])
                
    except Exception as e:
        print(f"Error duplicating Neo4j data: {e}", file=sys.stderr)
    finally:
        driver.close()


async def _delete_neo4j_data(migration_id: str):
    """Delete all nodes and relationships associated with a migration in Neo4j."""
    driver = _get_neo4j_driver()
    try:
        with driver.session() as session:
            # DETACH DELETE ensures relationships are also removed
            session.run(
                "MATCH (n {migration_id: $id}) DETACH DELETE n",
                id=migration_id
            )
    except Exception as e:
        print(f"Error deleting Neo4j data: {e}", file=sys.stderr)
    finally:
        driver.close()


def _get_embeddings(text: str) -> list[float]:
    """Generate embeddings for the given text using OpenAI."""
    with _get_db_connection() as conn:
        llm_settings = _get_llm_settings(conn)
        api_key = llm_settings.get('api_key') if llm_settings else os.getenv("OPENAI_API_KEY")
        base_url = llm_settings.get('base_url') if llm_settings else None
        
        provider = llm_settings.get('provider') if llm_settings else 'openai'
        if provider in ['ollama', 'custom'] and not api_key:
            api_key = "dummy-key"
    
    client = OpenAI(api_key=api_key, base_url=base_url)
    response = client.embeddings.create(
        input=[text],
        model="text-embedding-3-small"
    )
    return response.data[0].embedding


def _get_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a list of texts using OpenAI."""
    if not texts:
        return []
    with _get_db_connection() as conn:
        llm_settings = _get_llm_settings(conn)
        api_key = llm_settings.get('api_key') if llm_settings else os.getenv("OPENAI_API_KEY")
        base_url = llm_settings.get('base_url') if llm_settings else None
        
        provider = llm_settings.get('provider') if llm_settings else 'openai'
        if provider in ['ollama', 'custom'] and not api_key:
            api_key = "dummy-key"
    
    client = OpenAI(api_key=api_key, base_url=base_url)
    response = client.embeddings.create(
        input=texts,
        model="text-embedding-3-small"
    )
    return [item.embedding for item in response.data]


def _ensure_neo4j_vector_index(driver: neo4j.Driver, label: str):
    """Ensure a vector index exists in Neo4j for the given label."""
    # We use 1536 dimensions for text-embedding-3-small
    query = f"""
    CREATE VECTOR INDEX `vector_index_{label}` IF NOT EXISTS
    FOR (n:`{label}`)
    ON (n.embedding)
    OPTIONS {{
      indexConfig: {{
        `vector.dimensions`: 1536,
        `vector.similarity_function`: 'cosine'
      }}
    }}
    """
    with driver.session() as session:
        session.run(query)


@app.post("/api/neo4j/query")
async def query_neo4j(payload: Neo4jQueryPayload):
    """Execute a Cypher query in Neo4j."""
    driver = _get_neo4j_driver()
    try:
        with driver.session() as session:
            result = session.run(payload.query, **payload.params)
            return [dict(record) for record in result]
    except Exception as e:
        print(f"Neo4j query error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        driver.close()


@app.post("/api/neo4j/vector-search")
async def vector_search_neo4j(payload: Neo4jVectorSearchPayload):
    """Perform a vector similarity search in Neo4j."""
    if not payload.source_system:
        raise HTTPException(status_code=400, detail="source_system is required for vector search index.")
        
    driver = _get_neo4j_driver()
    try:
        embedding = await run_in_threadpool(_get_embeddings, payload.query_text)
        
        # Ensure index exists
        _ensure_neo4j_vector_index(driver, payload.source_system)
        
        query = f"""
        CALL db.index.vector.queryNodes('vector_index_{payload.source_system}', $limit, $embedding)
        YIELD node, score
        WHERE node.migration_id = $migration_id
        RETURN node, score
        """
        
        with driver.session() as session:
            result = session.run(
                query, 
                embedding=embedding, 
                limit=payload.limit, 
                migration_id=payload.migration_id
            )
            return [{"node": dict(record["node"]), "score": record["score"]} for record in result]
    except Exception as e:
        print(f"Neo4j vector search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        driver.close()


@app.post("/api/neo4j/vectorize")
async def vectorize_migration(migration_id: str, source_system: str):
    """Vectorize all nodes for a specific migration and system."""
    driver = _get_neo4j_driver()
    try:
        # 1. Fetch nodes that don't have an embedding yet
        query = f"""
        MATCH (n:`{source_system}`) 
        WHERE n.migration_id = $migration_id AND n.embedding IS NULL
        RETURN n.external_id as id, n.name as name, n.description as description, n.text as text
        """
        nodes_to_vectorize = []
        with driver.session() as session:
            result = session.run(query, migration_id=migration_id)
            nodes_to_vectorize = [dict(record) for record in result]
            
        if not nodes_to_vectorize:
            return {"status": "success", "message": "No nodes to vectorize."}
            
        # 2. Generate embeddings in batches and update nodes
        batch_size = 100
        for i in range(0, len(nodes_to_vectorize), batch_size):
            batch = nodes_to_vectorize[i:i + batch_size]
            texts_to_embed = []
            valid_nodes = []
            
            for node in batch:
                text = f"Name: {node.get('name', '')}\nDescription: {node.get('description', '')}\nText: {node.get('text', '')}"
                if text.strip():
                    texts_to_embed.append(text)
                    valid_nodes.append(node)
            
            if not texts_to_embed:
                continue
                
            embeddings = await run_in_threadpool(_get_embeddings_batch, texts_to_embed)
            
            with driver.session() as session:
                for node, embedding in zip(valid_nodes, embeddings):
                    session.run(
                        f"MATCH (n:`{source_system}`) WHERE n.migration_id = $migration_id AND n.external_id = $id "
                        f"SET n.embedding = $embedding",
                        migration_id=migration_id,
                        id=node['id'],
                        embedding=embedding
                    )
        
        return {"status": "success", "count": len(nodes_to_vectorize)}
    except Exception as e:
        print(f"Neo4j vectorization error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        driver.close()


@app.patch("/api/migrations/{id}", response_model=Migration)
async def update_migration(id: str, payload: UpdateMigrationPayload) -> Migration:
    """Update a migration in the database."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            updates: list[str] = []
            params: list[Any] = []
            
            payload_dict = payload.model_dump(exclude_none=True)
            for field, value in payload_dict.items():
                updates.append(f"{field} = %s")
                if isinstance(value, dict):
                    params.append(json.dumps(value))
                else:
                    params.append(value)
            
            if not updates:
                raise HTTPException(status_code=400, detail="No fields to update.")
            
            updates.append("updated_at = now()")
            params.append(id)

            query = f"""
                UPDATE public.migrations
                SET {", ".join(updates)}
                WHERE id = %s
                RETURNING id, name, source_system, target_system, source_url, target_url, in_connector, in_connector_detail, out_connector, out_connector_detail, objects_transferred, mapped_objects, project_id, notes, scope_config, workflow_state, progress, current_step, step_status, consultant_status, status, created_at, updated_at
            """
            
            cur.execute(query, tuple(params))
            row = cur.fetchone()
            conn.commit()
            
            if not row:
                raise HTTPException(status_code=404, detail="Migration not found.")
            
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
                scope_config=row["scope_config"],
                workflow_state=row["workflow_state"],
                progress=row["progress"],
                current_step=row["current_step"],
                step_status=row["step_status"],
                consultant_status=row["consultant_status"],
                status=row["status"],
                created_at=row["created_at"].isoformat(),
                updated_at=row["updated_at"].isoformat() if row["updated_at"] else None,
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error updating migration: {exc}")
        raise HTTPException(status_code=500, detail="Failed to update migration.") from exc

@app.post("/api/migrations/{id}/duplicate", response_model=Migration)
async def duplicate_migration(id: str, user_id: str) -> Migration:
    """Duplicate a migration, creating a new one with copied data and full state."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            # 1. Fetch original with all state fields
            cur.execute(
                """
                SELECT name, source_system, target_system, source_url, target_url, 
                       in_connector, in_connector_detail, out_connector, out_connector_detail, 
                       project_id, notes, scope_config,
                       current_step, step_status, status, progress, workflow_state,
                       objects_transferred, mapped_objects
                FROM public.migrations WHERE id = %s
                """,
                (id,),
            )
            original = cur.fetchone()
            if not original:
                raise HTTPException(status_code=404, detail="Migration not found.")

            # 2. Create new migration with preserved state
            new_name = f"{original['name']} (copy)"
            
            # Handle JSON fields serialization
            workflow_state_json = json.dumps(original["workflow_state"]) if original["workflow_state"] else None
            scope_config_json = json.dumps(original["scope_config"]) if original["scope_config"] else None

            # Map all fields explicitly to avoid counting errors
            fields = [
                "name", "source_system", "target_system", "source_url", "target_url",
                "project_id", "user_id", "in_connector", "in_connector_detail",
                "out_connector", "out_connector_detail", "notes", "scope_config",
                "current_step", "step_status", "status", "progress", "workflow_state",
                "objects_transferred", "mapped_objects"
            ]
            
            params = [
                new_name, original["source_system"], original["target_system"], 
                original["source_url"], original["target_url"], original["project_id"], 
                user_id, original["in_connector"], original["in_connector_detail"], 
                original["out_connector"], original["out_connector_detail"], 
                original["notes"], scope_config_json, original["current_step"], 
                original["step_status"], original["status"], original["progress"], 
                workflow_state_json, original["objects_transferred"], original["mapped_objects"]
            ]

            placeholders = ", ".join(["%s"] * len(fields))
            columns = ", ".join(fields)

            query = f"""
                INSERT INTO public.migrations ({columns})
                VALUES ({placeholders})
                RETURNING id, name, source_system, target_system, source_url, target_url, 
                          in_connector, in_connector_detail, out_connector, out_connector_detail, 
                          objects_transferred, mapped_objects, project_id, notes, scope_config, 
                          workflow_state, progress, current_step, step_status, consultant_status, status, created_at, updated_at
            """

            cur.execute(query, tuple(params))
            row = cur.fetchone()
            new_migration_id = row["id"]

            # 3. Duplicate connectors
            cur.execute(
                """
                INSERT INTO public.connectors (
                    migration_id, connector_type, api_url, api_key, username, 
                    password, endpoint, additional_config, auth_type, is_tested
                )
                SELECT %s, connector_type, api_url, api_key, username, 
                       password, endpoint, additional_config, auth_type, is_tested
                FROM public.connectors WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            # 3b. Duplicate Step 1-4 results
            cur.execute(
                """
                INSERT INTO public.step_1_results (
                    migration_id, system_mode, detected_system, confidence_score, 
                    api_type, api_subtype, recommended_base_url, raw_json
                )
                SELECT %s, system_mode, detected_system, confidence_score, 
                       api_type, api_subtype, recommended_base_url, raw_json
                FROM public.step_1_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            cur.execute(
                """
                INSERT INTO public.step_2_results (
                    migration_id, system_mode, is_authenticated, auth_type, 
                    error_message, raw_json
                )
                SELECT %s, system_mode, is_authenticated, auth_type, 
                       error_message, raw_json
                FROM public.step_2_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            cur.execute(
                """
                INSERT INTO public.step_3_results (
                    migration_id, entity_name, count, complexity, 
                    error_message, raw_json
                )
                SELECT %s, entity_name, count, complexity, 
                       error_message, raw_json
                FROM public.step_3_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            cur.execute(
                """
                INSERT INTO public.step_4_results (
                    migration_id, target_scope_id, target_scope_name, target_status, 
                    writable_entities, missing_permissions, summary, raw_json
                )
                SELECT %s, target_scope_id, target_scope_name, target_status, 
                       writable_entities, missing_permissions, summary, raw_json
                FROM public.step_4_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            # 3c. Duplicate Step 5 results
            cur.execute(
                """
                INSERT INTO public.step_5_results (
                    migration_id, summary, raw_json
                )
                SELECT %s, summary, raw_json
                FROM public.step_5_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            cur.execute(
                """
                INSERT INTO public.step_6_results (
                    migration_id, summary, raw_json
                )
                SELECT %s, summary, raw_json
                FROM public.step_6_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            cur.execute(
                """
                INSERT INTO public.step_7_results (
                    migration_id, summary, raw_json
                )
                SELECT %s, summary, raw_json
                FROM public.step_7_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            cur.execute(
                """
                INSERT INTO public.step_8_results (
                    migration_id, summary, raw_json
                )
                SELECT %s, summary, raw_json
                FROM public.step_8_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            cur.execute(
                """
                INSERT INTO public.step_9_results (
                    migration_id, summary, raw_json
                )
                SELECT %s, summary, raw_json
                FROM public.step_9_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            cur.execute(
                """
                INSERT INTO public.step_10_results (
                    migration_id, summary, raw_json
                )
                SELECT %s, summary, raw_json
                FROM public.step_10_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            # 3d. Duplicate Mapping Rules
            cur.execute(
                """
                INSERT INTO public.mapping_rules (
                    migration_id, source_system, source_object, source_property, 
                    target_system, target_object, target_property, note, rule_type, enhancements
                )
                SELECT %s, source_system, source_object, source_property, 
                       target_system, target_object, target_property, note, rule_type, enhancements
                FROM public.mapping_rules WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            # 4. Duplicate pipelines, mappings, and agent states
            cur.execute(
                """
                SELECT id, name, description, source_data_source_id, target_data_source_id, 
                       source_system, target_system, execution_order, is_active, 
                       progress, objects_transferred, mapped_objects, workflow_type
                FROM public.pipelines WHERE migration_id = %s
                """,
                (id,),
            )
            pipelines = cur.fetchall()
            for p in pipelines:
                old_pipeline_id = p["id"]
                cur.execute(
                    """
                    INSERT INTO public.pipelines (
                        migration_id, name, description, source_data_source_id, target_data_source_id, 
                        source_system, target_system, execution_order, is_active, 
                        progress, objects_transferred, mapped_objects, workflow_type
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        new_migration_id,
                        p["name"],
                        p["description"],
                        p["source_data_source_id"],
                        p["target_data_source_id"],
                        p["source_system"],
                        p["target_system"],
                        p["execution_order"],
                        p["is_active"],
                        p["progress"],
                        p["objects_transferred"],
                        p["mapped_objects"],
                        p["workflow_type"],
                    ),
                )
                new_pipeline_row = cur.fetchone()
                new_pipeline_id = new_pipeline_row["id"]

                # Duplicate field mappings
                cur.execute(
                    """
                    INSERT INTO public.field_mappings (
                        pipeline_id, target_field_id, source_field_id, mapping_type, 
                        collection_item_field_id, join_with, description, 
                        source_object_type, target_object_type
                    )
                    SELECT %s, target_field_id, source_field_id, mapping_type, 
                           collection_item_field_id, join_with, description, 
                           source_object_type, target_object_type
                    FROM public.field_mappings WHERE pipeline_id = %s
                    """,
                    (new_pipeline_id, old_pipeline_id)
                )

                # Duplicate agent workflow state
                cur.execute(
                    """
                    INSERT INTO public.agent_workflow_states (
                        pipeline_id, briefing, plan, completed_steps, logs, is_running
                    )
                    SELECT %s, briefing, plan, completed_steps, logs, false
                    FROM public.agent_workflow_states WHERE pipeline_id = %s
                    """,
                    (new_pipeline_id, old_pipeline_id)
                )

            # 5. Duplicate migration_steps (History)
            cur.execute(
                """
                INSERT INTO public.migration_steps (
                    migration_id, workflow_step_id, name, status, status_message, result, created_at, updated_at
                )
                SELECT %s, workflow_step_id, name, status, status_message, result, created_at, updated_at
                FROM public.migration_steps WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            # 6. Duplicate migration_chat_messages (History)
            cur.execute(
                """
                INSERT INTO public.migration_chat_messages (
                    migration_id, role, content, step_number, created_at
                )
                SELECT %s, role, content, step_number, created_at
                FROM public.migration_chat_messages WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            # 6b. Duplicate mapping_chat_messages (Step 6/7 History)
            cur.execute(
                """
                INSERT INTO public.mapping_chat_messages (
                    migration_id, role, content, created_at
                )
                SELECT %s, role, content, created_at
                FROM public.mapping_chat_messages WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            # 7. Duplicate migration_activities (Timeline)
            cur.execute(
                """
                INSERT INTO public.migration_activities (
                    migration_id, type, title, timestamp, created_at
                )
                SELECT %s, type, title, timestamp, created_at
                FROM public.migration_activities WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            # 8. Add duplication welcome messages to the chat
            welcome_msg_1 = f"Diese Migration wurde von **{original['name']}** dupliziert."
            
            cur.execute(
                """
                INSERT INTO public.migration_chat_messages (migration_id, role, content, step_number)
                VALUES (%s, 'system', %s, 0)
                """,
                (new_migration_id, welcome_msg_1)
            )

            # 9. Add activity for duplication
            cur.execute(
                """
                INSERT INTO public.migration_activities (migration_id, type, title, timestamp)
                VALUES (%s, 'info', 'Migration dupliziert', %s)
                """,
                (new_migration_id, datetime.now(timezone.utc).isoformat())
            )

            conn.commit()

            # 10. Duplicate Neo4j data (Async)
            await _duplicate_neo4j_data(id, str(new_migration_id))

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
                scope_config=row["scope_config"],
                workflow_state=row["workflow_state"],
                progress=row["progress"],
                current_step=row["current_step"],
                step_status=row["step_status"],
                consultant_status=row["consultant_status"],
                status=row["status"],
                created_at=row["created_at"].isoformat(),
                updated_at=row["updated_at"].isoformat() if row["updated_at"] else None,
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error duplicating migration: {exc}")
        raise HTTPException(status_code=500, detail="Failed to duplicate migration.") from exc

@app.delete("/api/migrations/{id}")
async def delete_migration(id: str) -> dict[str, str]:
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
            
            # Delete Neo4j data
            await _delete_neo4j_data(id)

            conn.commit()
            
            return {"message": f"Migration {id} and related records deleted successfully."}
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error deleting migration: {exc}")
        raise HTTPException(status_code=500, detail="Failed to delete migration.") from exc


from routers import data_sources

app.include_router(
    data_sources.router,
    prefix="/api/data_sources",
    tags=["data_sources"],
)




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


# ============================================================================
# Project Members Endpoints
# ============================================================================

class ProjectMember(BaseModel):
    """Pydantic model for a project member."""
    id: str
    project_id: str
    user_id: str
    role: str
    created_at: str


class CreateProjectMemberPayload(BaseModel):
    """Pydantic model for creating a project member."""
    project_id: str
    user_id: str
    role: str = "member"


@app.get("/api/project_members", response_model=list[ProjectMember])
async def get_project_members(
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> list[ProjectMember]:
    """Fetch project members, optionally filtered by project_id or user_id."""
    project_id = _strip_eq_prefix(project_id)
    user_id = _strip_eq_prefix(user_id)
    
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            query = "SELECT id, project_id, user_id, role, created_at FROM public.project_members"
            conditions: list[str] = []
            params: list[Any] = []

            if project_id:
                conditions.append("project_id = %s")
                params.append(project_id)
            if user_id:
                conditions.append("user_id = %s")
                params.append(user_id)

            if conditions:
                query += " WHERE " + " AND ".join(conditions)

            query += " ORDER BY created_at DESC"

            cur.execute(query, tuple(params))
            rows = cur.fetchall()
            return [
                ProjectMember(
                    id=str(row["id"]),
                    project_id=str(row["project_id"]),
                    user_id=str(row["user_id"]),
                    role=row["role"],
                    created_at=row["created_at"].isoformat() if row.get("created_at") else "",
                )
                for row in rows
            ]
    except Exception as exc:
        print(f"Error fetching project members: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch project members.") from exc


@app.post("/api/project_members", response_model=ProjectMember)
async def create_project_member(payload: CreateProjectMemberPayload) -> ProjectMember:
    """Add a member to a project."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.project_members (project_id, user_id, role)
                VALUES (%s, %s, %s)
                ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
                RETURNING id, project_id, user_id, role, created_at
                """,
                (payload.project_id, payload.user_id, payload.role),
            )
            row = cur.fetchone()
            conn.commit()

            if not row:
                raise HTTPException(status_code=500, detail="Failed to create project member.")

            return ProjectMember(
                id=str(row["id"]),
                project_id=str(row["project_id"]),
                user_id=str(row["user_id"]),
                role=row["role"],
                created_at=row["created_at"].isoformat() if row.get("created_at") else "",
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error creating project member: {exc}")
        raise HTTPException(status_code=500, detail="Failed to create project member.") from exc


@app.delete("/api/project_members")
async def delete_project_member(
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> dict[str, str]:
    """Remove a member from a project."""
    project_id = _strip_eq_prefix(project_id)
    user_id = _strip_eq_prefix(user_id)
    
    if not project_id or not user_id:
        raise HTTPException(
            status_code=400,
            detail="Both 'project_id' and 'user_id' are required.",
        )

    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM public.project_members WHERE project_id = %s AND user_id = %s RETURNING id",
                (project_id, user_id),
            )
            deleted = cur.fetchone()
            conn.commit()

            if not deleted:
                raise HTTPException(status_code=404, detail="Project member not found.")

            return {"message": "Project member removed successfully."}
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error deleting project member: {exc}")
        raise HTTPException(status_code=500, detail="Failed to delete project member.") from exc


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
                "timeout": 15,
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
                "timeout": 15,
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
                "timeout": 15,
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
                (step_row["id"], json.dumps(payload.model_dump())),
            )
            job_row = cur.fetchone()

            if job_row:
                publish_to_rabbitmq(job_row["id"])

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


@app.get("/api/migrations/{id}/results")
async def get_migration_results(id: str) -> dict[str, Any]:
    """Fetch all structured results for steps 1 to 9."""
    try:
        results = {
            "step_1": [], "step_2": [], "step_3": [], "step_4": [], 
            "step_5": [], "step_6": [], "step_7": [], "step_8": [], "step_9": []
        }
        with _get_db_connection() as conn, conn.cursor() as cur:
            # Step 1
            cur.execute("SELECT * FROM public.step_1_results WHERE migration_id = %s", (id,))
            results["step_1"] = [dict(row) for row in cur.fetchall()]
            
            # Step 2
            cur.execute("SELECT * FROM public.step_2_results WHERE migration_id = %s", (id,))
            results["step_2"] = [dict(row) for row in cur.fetchall()]
            
            # Step 3
            cur.execute("SELECT * FROM public.step_3_results WHERE migration_id = %s", (id,))
            results["step_3"] = [dict(row) for row in cur.fetchall()]

            # Step 4
            cur.execute("SELECT * FROM public.step_4_results WHERE migration_id = %s", (id,))
            results["step_4"] = [dict(row) for row in cur.fetchall()]

            # Step 5
            cur.execute("SELECT * FROM public.step_5_results WHERE migration_id = %s", (id,))
            results["step_5"] = [dict(row) for row in cur.fetchall()]

            # Step 6
            cur.execute("SELECT * FROM public.step_6_results WHERE migration_id = %s", (id,))
            results["step_6"] = [dict(row) for row in cur.fetchall()]

            # Step 7
            cur.execute("SELECT * FROM public.step_7_results WHERE migration_id = %s", (id,))
            results["step_7"] = [dict(row) for row in cur.fetchall()]

            # Step 8
            cur.execute("SELECT * FROM public.step_8_results WHERE migration_id = %s", (id,))
            results["step_8"] = [dict(row) for row in cur.fetchall()]

            # Step 9
            cur.execute("SELECT * FROM public.step_9_results WHERE migration_id = %s", (id,))
            results["step_9"] = [dict(row) for row in cur.fetchall()]
            
        return results
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/api/schemes/objects/{system_name}")
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

@app.get("/api/migrations/{id}/pipelines")
async def get_migration_pipelines(id: str) -> list[dict[str, Any]]:
    """Fetch all pipelines for a given migration."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, migration_id, name, description, source_system, target_system, execution_order, is_active FROM public.pipelines WHERE migration_id = %s ORDER BY execution_order ASC",
                (id,)
            )
            rows = cur.fetchall()
            return [dict(row) for row in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/api/pipelines/{id}/mappings")
async def get_pipeline_mappings(id: str) -> list[dict[str, Any]]:
    """Fetch all field mappings for a given pipeline."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, pipeline_id, target_field_id, source_field_id, mapping_type, collection_item_field_id, join_with, description, source_object_type, target_object_type FROM public.field_mappings WHERE pipeline_id = %s",
                (id,)
            )
            rows = cur.fetchall()
            return [dict(row) for row in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

class UpdateResultPayload(BaseModel):
    step: int
    system_mode: Optional[str] = None # For step 1 & 2
    entity_name: Optional[str] = None # For step 3
    new_json: Dict[str, Any]

@app.patch("/api/migrations/{id}/results")
async def update_migration_result(id: str, payload: UpdateResultPayload) -> dict[str, Any]:
    """Update or create a specific agent result record (UPSERT)."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            if payload.step == 1:
                cur.execute(
                    """
                    INSERT INTO public.step_1_results (migration_id, system_mode, raw_json, updated_at)
                    VALUES (%s, %s, %s, now())
                    ON CONFLICT (migration_id, system_mode) DO UPDATE SET
                        raw_json = EXCLUDED.raw_json,
                        updated_at = now()
                    """,
                    (id, payload.system_mode, json.dumps(payload.new_json))
                )
            elif payload.step == 2:
                cur.execute(
                    """
                    INSERT INTO public.step_2_results (migration_id, system_mode, raw_json, updated_at)
                    VALUES (%s, %s, %s, now())
                    ON CONFLICT (migration_id, system_mode) DO UPDATE SET
                        raw_json = EXCLUDED.raw_json,
                        updated_at = now()
                    """,
                    (id, payload.system_mode, json.dumps(payload.new_json))
                )
            elif payload.step == 3:
                cur.execute(
                    """
                    INSERT INTO public.step_3_results (migration_id, entity_name, raw_json, updated_at)
                    VALUES (%s, %s, %s, now())
                    ON CONFLICT (migration_id, entity_name) DO UPDATE SET
                        raw_json = EXCLUDED.raw_json,
                        updated_at = now()
                    """,
                    (id, payload.entity_name, json.dumps(payload.new_json))
                )
            elif payload.step in [4, 5, 6, 7, 8, 9]:
                table_name = f"step_{payload.step}_results"
                cur.execute(
                    f"""
                    INSERT INTO public.{table_name} (migration_id, raw_json, updated_at)
                    VALUES (%s, %s, now())
                    ON CONFLICT (migration_id) DO UPDATE SET
                        raw_json = EXCLUDED.raw_json,
                        updated_at = now()
                    """,
                    (id, json.dumps(payload.new_json))
                )
            conn.commit()
        return {"message": "Result updated successfully"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@app.post("/api/migrations/{id}/inventory/{entity_name}/toggle-ignore")
async def toggle_entity_ignore(id: str, entity_name: str, display_name: Optional[str] = None) -> dict[str, Any]:
    """Toggle the ignore status of an entity in the inventory (Step 3 Results)."""
    try:
        with _get_db_connection() as conn, conn.cursor() as cur:
            # First try by entity_name (technical key)
            cur.execute(
                "UPDATE public.step_3_results SET is_ignored = NOT is_ignored WHERE migration_id = %s AND entity_name = %s RETURNING is_ignored, entity_name",
                (id, entity_name),
            )
            row = cur.fetchone()
            
            # If not found and display_name is provided, try by display_name
            if not row and display_name:
                cur.execute(
                    "UPDATE public.step_3_results SET is_ignored = NOT is_ignored WHERE migration_id = %s AND entity_name = %s RETURNING is_ignored, entity_name",
                    (id, display_name),
                )
                row = cur.fetchone()

            if not row:
                # If still not found, insert it as a new entry (assuming it was implicit/not ignored before)
                cur.execute(
                    """
                    INSERT INTO public.step_3_results (migration_id, entity_name, is_ignored, count)
                    VALUES (%s, %s, true, 0)
                    RETURNING is_ignored, entity_name
                    """,
                    (id, entity_name)
                )
                row = cur.fetchone()
            
            conn.commit()
            return {"entity_name": row["entity_name"], "is_ignored": row["is_ignored"]}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/api/llm-settings")
async def get_llm_settings():
    try:
        with _get_db_connection() as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute("SELECT id, provider, model, base_url, api_key FROM public.llm_settings ORDER BY updated_at DESC")
            settings = cur.fetchall()
            # Mask api_key for security
            for s in settings:
                if s.get('api_key'):
                    s['api_key'] = "************"
            return settings
    except Exception as exc:
        print(f"Error in GET /api/llm-settings: {exc}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))

@app.post("/api/llm-settings")
async def save_llm_settings(settings: dict):
    try:
        with _get_db_connection() as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
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
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))

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