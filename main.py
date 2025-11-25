"""Celion FastAPI entry point now providing legacy notices only."""
# pyright: reportMissingImports=false

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from typing import Any

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


class DetectionRequest(BaseModel):
    """Request payload kept for backward compatibility with legacy clients."""

    url: HttpUrl


class LegacyResponse(BaseModel):
    """Response returned when legacy agent endpoints are invoked."""

    message: str


class ProbeEvidence(BaseModel):
    """Metadata describing the performed credential probe."""

    request_url: HttpUrl | str
    method: str
    used_headers: list[str]
    timestamp: str


class ProbeRequest(BaseModel):
    """Request payload for forwarding credential probes through the backend."""

    method: str
    url: HttpUrl
    headers: dict[str, str]
    body: Any | None = None
    request_format: str | None = None
    graphql: dict[str, Any] | None = None


class ProbeResponse(BaseModel):
    """Normalized response returned to the frontend after performing the probe."""

    status: int | None
    ok: bool
    body: Any | None
    raw_response: str | None
    error: str | None
    evidence: ProbeEvidence


SchemaProbeRequest = ProbeRequest
SchemaProbeResponse = ProbeResponse


class HttpClientRequest(BaseModel):
    """Generic HTTP request payload executed by the backend."""

    url: HttpUrl
    method: str
    headers: dict[str, str] | None = None
    body: Any | None = None


class HttpClientResponse(BaseModel):
    """Normalized HTTP response for the agent httpClient tool."""

    status: int | None
    headers: dict[str, str]
    body: Any | None
    error: str | None = None


class CurlHeadProbeRequest(BaseModel):
    """Request payload for executing a curl-style HEAD probe via the backend."""

    url: HttpUrl
    headers: dict[str, str] | None = None
    follow_redirects: bool = True


class CurlHeadProbeResponse(BaseModel):
    """Normalized response for curl_head_probe to expose headers and redirects."""

    status: int | None
    headers: dict[str, str]
    redirects: list[dict[str, Any]]
    final_url: str | None
    raw_response: str | None
    error: str | None = None


def _legacy_http_exception() -> HTTPException:
    """Provide a consistent 410 response when legacy endpoints are used."""

    return HTTPException(status_code=410, detail=LEGACY_MESSAGE)


@app.post("/agents/system-detection", response_model=LegacyResponse)
async def run_system_detection(payload: DetectionRequest) -> LegacyResponse:
    """Inform callers that the Python discovery agent has been removed."""

    raise _legacy_http_exception()


@app.get("/auth-flow", response_model=LegacyResponse)
async def run_auth_flow(
    base_url: str,
    system: str,
    auth_type: str,
    api_token: str | None = None,
    username: str | None = None,
    password: str | None = None,
) -> LegacyResponse:
    """Inform callers that the Python auth flow agent has been removed."""

    raise _legacy_http_exception()


@app.post("/api/probe", response_model=ProbeResponse)
async def run_credential_probe(payload: ProbeRequest) -> ProbeResponse:
    """Execute credential probe requests on the server to avoid browser CORS limits."""

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

        body: Any | None
        raw_response: str | None
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

    return await run_credential_probe(payload)  # type: ignore[arg-type]


@app.post("/api/http-client", response_model=HttpClientResponse)
async def run_http_client(payload: HttpClientRequest) -> HttpClientResponse:
    """Execute arbitrary HTTP requests on behalf of the agent without browser CORS limits."""

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

        body: Any | None
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

