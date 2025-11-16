"""Auth Flow Agent that validates authentication credentials against the detected system."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict

import requests
from dotenv import load_dotenv
from openai import OpenAI


# Ensure environment variables from the local .env file are available when the
# agent service starts. This allows the OpenAI client to pick up the API key
# that is configured for the project without requiring additional shell
# configuration.
_DOTENV_PATH = Path(__file__).resolve().parent.parent / ".env"
if _DOTENV_PATH.exists():
    load_dotenv(dotenv_path=_DOTENV_PATH, override=True)


@dataclass
class AuthFlowResult:
    """Normalized response returned by the auth flow validation agent."""

    authenticated: bool
    auth_method: str | None
    permissions: list[str]
    validation_evidence: Dict[str, Any]
    error_message: str | None
    raw_output: str

    @classmethod
    def from_response(cls, response: Dict[str, Any], raw_output: str) -> "AuthFlowResult":
        """Create a :class:`AuthFlowResult` from the agent response."""

        validation_evidence = response.get("validation_evidence")
        if not isinstance(validation_evidence, dict):
            validation_evidence = {}

        def _optional_str(value: Any) -> str | None:
            return value if isinstance(value, str) and value.strip() else None

        permissions = response.get("permissions", [])
        if not isinstance(permissions, list):
            permissions = []

        return cls(
            authenticated=bool(response.get("authenticated")),
            auth_method=_optional_str(response.get("auth_method")),
            permissions=permissions,
            validation_evidence=validation_evidence,
            error_message=_optional_str(response.get("error_message")),
            raw_output=raw_output,
        )


client = OpenAI()


def validate_auth(
    base_url: str,
    system: str,
    auth_type: str,
    api_token: str | None = None,
    username: str | None = None,
    password: str | None = None,
) -> AuthFlowResult:
    """Run the auth flow validation agent and return a normalized result."""

    agent = client.agents.create(
        name="Celion Auth Flow Agent",
        model="gpt-4.1",
        instructions=(
            "Du bist der Celion Auth Flow Agent. "
            f"Deine Aufgabe ist es, die Authentifizierung für ein {system}-System an der Base-URL {base_url} zu validieren. "
            f"Der Authentifizierungstyp ist: {auth_type}. "
            "Nutze den API Tester, um verschiedene API-Endpunkte mit den gegebenen Credentials zu testen. "
            "Prüfe, ob die Authentifizierung erfolgreich ist und welche Berechtigungen verfügbar sind. "
            "Teste gängige Endpunkte des Systems (z.B. /rest/api/3/myself für Jira, /api/v1/users/me für andere Systeme). "
            "Antworte immer als JSON mit den Feldern: "
            "authenticated (boolean), auth_method (string), permissions (array), validation_evidence (object), error_message (string oder null)."
        ),
        tools=[
            {
                "name": "call_api_tester",
                "type": "function",
                "description": "Führt einen authentifizierten API-Request aus und liefert Status und Response.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "endpoint": {"type": "string", "description": "Der API-Endpunkt relativ zur Base-URL"},
                        "method": {"type": "string", "enum": ["GET", "POST"], "description": "HTTP-Methode"},
                    },
                    "required": ["endpoint"],
                },
            }
        ],
    )

    thread = client.threads.create()
    
    # Build credentials message
    creds_info = []
    if auth_type == "token" and api_token:
        creds_info.append(f"API Token: {api_token}")
    elif auth_type == "credentials" and username and password:
        creds_info.append(f"Username: {username}")
        creds_info.append(f"Password: {password}")
    
    creds_message = " | ".join(creds_info) if creds_info else "Keine Credentials angegeben"
    
    client.messages.create(
        thread_id=thread.id,
        role="user",
        content=f"Validiere die Authentifizierung für {system} an {base_url}. Credentials: {creds_message}",
    )

    run = client.runs.create(thread_id=thread.id, agent_id=agent.id)

    while True:
        status = client.runs.retrieve(thread_id=thread.id, run_id=run.id)

        if status.status == "requires_action":
            tool_calls = status.required_action.submit_tool_outputs.tool_calls
            tool_outputs = []

            for tool_call in tool_calls:
                if tool_call.function.name == "call_api_tester":
                    args = json.loads(tool_call.function.arguments)
                    result = _call_api_tester(
                        base_url=base_url,
                        endpoint=args.get("endpoint", ""),
                        method=args.get("method", "GET"),
                        auth_type=auth_type,
                        api_token=api_token,
                        username=username,
                        password=password,
                    )
                    tool_outputs.append(
                        {"tool_call_id": tool_call.id, "output": json.dumps(result)}
                    )

            client.runs.submit_tool_outputs(
                thread_id=thread.id, run_id=run.id, tool_outputs=tool_outputs
            )

        elif status.status == "completed":
            break
        elif status.status in ("failed", "cancelled", "expired"):
            error_msg = getattr(status.last_error, "message", "Unknown error") if status.last_error else "Unknown error"
            return AuthFlowResult(
                authenticated=False,
                auth_method=None,
                permissions=[],
                validation_evidence={},
                error_message=f"Agent execution failed: {error_msg}",
                raw_output="",
            )

        time.sleep(0.5)

    messages = client.messages.list(thread_id=thread.id, order="desc", limit=1)
    if not messages.data:
        return AuthFlowResult(
            authenticated=False,
            auth_method=None,
            permissions=[],
            validation_evidence={},
            error_message="No response from agent",
            raw_output="",
        )

    message = messages.data[0]
    text_blocks = [
        content.text.value
        for content in message.content
        if content.type == "text" and hasattr(content, "text")
    ]
    raw_output = "\n".join(text_blocks)

    try:
        # Try to parse JSON from the response
        for block in text_blocks:
            try:
                parsed = json.loads(block)
                return AuthFlowResult.from_response(parsed, raw_output)
            except json.JSONDecodeError:
                continue
        
        # If no valid JSON found, return error
        return AuthFlowResult(
            authenticated=False,
            auth_method=None,
            permissions=[],
            validation_evidence={},
            error_message="Could not parse agent response",
            raw_output=raw_output,
        )
    except Exception as e:
        return AuthFlowResult(
            authenticated=False,
            auth_method=None,
            permissions=[],
            validation_evidence={},
            error_message=f"Error processing response: {str(e)}",
            raw_output=raw_output,
        )


def _call_api_tester(
    base_url: str,
    endpoint: str,
    method: str,
    auth_type: str,
    api_token: str | None,
    username: str | None,
    password: str | None,
) -> Dict[str, Any]:
    """Execute an authenticated API request and return the result."""
    
    url = f"{base_url.rstrip('/')}/{endpoint.lstrip('/')}"
    headers = {"Accept": "application/json"}
    
    # Add authentication
    auth = None
    if auth_type == "token" and api_token:
        headers["Authorization"] = f"Bearer {api_token}"
    elif auth_type == "credentials" and username and password:
        auth = (username, password)
    
    try:
        response = requests.request(
            method=method,
            url=url,
            headers=headers,
            auth=auth,
            timeout=10,
        )
        
        result = {
            "status_code": response.status_code,
            "success": 200 <= response.status_code < 300,
            "headers": dict(response.headers),
        }
        
        try:
            result["body"] = response.json()
        except:
            result["body"] = response.text[:500]  # Limit text response
        
        return result
    except Exception as e:
        return {
            "status_code": 0,
            "success": False,
            "error": str(e),
        }
