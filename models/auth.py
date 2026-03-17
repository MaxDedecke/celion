from pydantic import BaseModel
from typing import Optional

class AuthPayload(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None

class SyncUserPayload(BaseModel):
    """Payload for syncing a user (from Keycloak or other sources)."""
    id: str
    email: str
    full_name: Optional[str] = None
