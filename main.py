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
from fastapi import FastAPI, HTTPException
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
