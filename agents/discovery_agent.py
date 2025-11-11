"""Discovery agent that uses the OpenAI Assistants API to identify systems."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Dict

import requests
from openai import OpenAI


@dataclass
class DiscoveryResult:
    """Normalized response returned by the system detection agent."""

    detected: bool
    system: str | None
    api_version: str | None
    confidence: float | None
    base_url: str | None
    detection_evidence: Dict[str, Any]
    raw_output: str

    @classmethod
    def from_response(cls, response: Dict[str, Any], raw_output: str) -> "DiscoveryResult":
        """Create a :class:`DiscoveryResult` from the agent response."""

        detection_evidence = response.get("detection_evidence")
        if not isinstance(detection_evidence, dict):
            detection_evidence = {}

        def _optional_str(value: Any) -> str | None:
            return value if isinstance(value, str) and value.strip() else None

        def _optional_float(value: Any) -> float | None:
            try:
                return float(value)
            except (TypeError, ValueError):
                return None

        return cls(
            detected=bool(response.get("detected")),
            system=_optional_str(response.get("system")),
            api_version=_optional_str(response.get("api_version")),
            confidence=_optional_float(response.get("confidence")),
            base_url=_optional_str(response.get("base_url")),
            detection_evidence=detection_evidence,
            raw_output=raw_output,
        )


client = OpenAI()


def detect_system(url: str) -> DiscoveryResult:
    """Run the discovery agent and return a normalized result."""

    agent = client.agents.create(
        name="Celion System Detection Agent",
        model="gpt-4.1",
        instructions=(
            "Du bist der Celion System Detection Agent. "
            "Analysiere, ob eine URL zu einem bekannten Systemtyp gehört. "
            "Nutze den Probe Runner, um API-Endpunkte zu prüfen. "
            "Antworte immer als JSON mit den Feldern: "
            "detected, system, api_version, confidence, base_url, detection_evidence."
        ),
        tools=[
            {
                "name": "call_probe_runner",
                "type": "function",
                "description": "Führt API-Probes aus und liefert Header/Statuscodes.",
                "parameters": {
                    "type": "object",
                    "properties": {"url": {"type": "string"}},
                    "required": ["url"],
                },
            }
        ],
    )

    thread = client.threads.create()
    client.messages.create(
        thread_id=thread.id,
        role="user",
        content=f"Analysiere {url} und erkenne das System.",
    )

    run = client.runs.create(thread_id=thread.id, agent_id=agent.id)

    while True:
        status = client.runs.retrieve(thread_id=thread.id, run_id=run.id)
        if status.status == "requires_action":
            tool_call = status.required_action.submit_tool_outputs.tool_calls[0]
            args = json.loads(tool_call.function.arguments)

            probe_data = requests.get(
                "http://localhost:5005/probe", params={"url": args["url"]}, timeout=10
            ).json()

            client.runs.submit_tool_outputs(
                thread_id=thread.id,
                run_id=run.id,
                tool_outputs=[
                    {
                        "tool_call_id": tool_call.id,
                        "output": json.dumps(probe_data),
                    }
                ],
            )
        elif status.status == "completed":
            break
        elif status.status in {"failed", "cancelled"}:
            raise RuntimeError(f"Agent execution failed with status: {status.status}")
        else:
            time.sleep(1)

    messages = client.messages.list(thread_id=thread.id)
    raw_output = messages.data[0].content[0].text.value.strip()

    try:
        parsed_output = json.loads(raw_output)
    except json.JSONDecodeError:
        parsed_output = {
            "detected": False,
            "system": None,
            "api_version": None,
            "confidence": None,
            "base_url": None,
            "detection_evidence": {"raw_response": raw_output},
        }

    parsed_output.setdefault("detection_evidence", {})
    if not isinstance(parsed_output["detection_evidence"], dict):
        parsed_output["detection_evidence"] = {"raw": parsed_output["detection_evidence"]}

    parsed_output["raw_output"] = raw_output

    return DiscoveryResult.from_response(parsed_output, raw_output)


__all__ = ["detect_system", "DiscoveryResult"]

