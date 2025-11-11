"""Entry point for running the Celion discovery agent as an API or CLI."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl

from agents.discovery_agent import DiscoveryResult, detect_system


app = FastAPI(title="Celion Agent Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DetectionRequest(BaseModel):
    """Request payload for the system detection agent."""

    url: HttpUrl


class DetectionResponse(BaseModel):
    """Serialized response returned by the system detection agent."""

    detected: bool
    system: str | None
    api_version: str | None
    confidence: float | None
    base_url: str | None
    detection_evidence: Dict[str, Any]
    raw_output: str

    @classmethod
    def from_result(cls, result: DiscoveryResult) -> "DetectionResponse":
        return cls(
            detected=result.detected,
            system=result.system,
            api_version=result.api_version,
            confidence=result.confidence,
            base_url=result.base_url,
            detection_evidence=result.detection_evidence,
            raw_output=result.raw_output,
        )


@app.post("/agents/system-detection", response_model=DetectionResponse)
async def run_system_detection(payload: DetectionRequest) -> DetectionResponse:
    """Execute the system detection agent for a given URL."""

    try:
        result = detect_system(str(payload.url))
    except Exception as exc:  # noqa: BLE001 - we want to surface detailed errors to the client
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return DetectionResponse.from_result(result)


def _cli(url: str) -> int:
    """Run the agent in CLI mode and print the response as JSON."""

    try:
        result = detect_system(url)
    except Exception as exc:  # noqa: BLE001 - provide graceful CLI error handling
        print(f"Fehler bei der Systemerkennung: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(DetectionResponse.from_result(result).dict(), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Starte die Celion Systemerkennung")
    parser.add_argument("url", nargs="?", help="Basis-URL des Zielsystems")
    args = parser.parse_args()

    if args.url:
        raise SystemExit(_cli(args.url))

    try:
        user_url = input("🔗 Gib eine System-URL ein: ").strip()
    except KeyboardInterrupt:  # pragma: no cover - interactive usage
        print("\nAbgebrochen.")
        raise SystemExit(1)

    if not user_url:
        print("Es wurde keine URL angegeben.", file=sys.stderr)
        raise SystemExit(1)

    raise SystemExit(_cli(user_url))

