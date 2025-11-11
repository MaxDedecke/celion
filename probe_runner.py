"""Simple HTTP probe runner that forwards requests to candidate endpoints."""

from __future__ import annotations

from typing import Dict

import requests
from fastapi import FastAPI

app = FastAPI(title="Celion Probe Runner")


PATTERNS: Dict[str, str] = {
    "jira_cloud_v3": "/rest/api/3/serverInfo",
    "jira_server_v2": "/rest/api/2/serverInfo",
    "asana": "/api/1.0/users/me",
    "azure_devops": "/_apis/projects",
    "clickup": "/api/v2/team",
    "targetprocess": "/api/v2/Projects",
}


@app.get("/probe")
def probe(url: str):
    """Probe a base URL using a list of known API paths."""

    results = {}
    for name, path in PATTERNS.items():
        full_url = f"{url.rstrip('/')}{path}"
        try:
            response = requests.get(full_url, timeout=3)
            results[name] = {
                "url": full_url,
                "status": response.status_code,
                "headers": dict(response.headers),
                "content_snippet": response.text[:150],
            }
        except Exception as exc:  # noqa: BLE001 - we want to capture transport errors
            results[name] = {"error": str(exc)}

    return {"target": url, "results": results}


__all__ = ["app"]

