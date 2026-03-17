from pydantic import BaseModel, HttpUrl
from typing import Optional, Dict, Any

class ProbeEvidence(BaseModel):
    request_url: str
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
