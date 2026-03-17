from pydantic import BaseModel
from typing import Optional, Dict, Any

class Connector(BaseModel):
    """Pydantic model for a connector."""
    id: str
    migration_id: str
    connector_type: str
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    endpoint: Optional[str] = None
    auth_type: str = "api_key"
    additional_config: Optional[Dict[str, Any]] = None
    is_tested: bool = False
    created_at: str
    updated_at: Optional[str] = None

class CreateConnectorPayload(BaseModel):
    """Pydantic model for creating a connector."""
    migration_id: str
    connector_type: str
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    endpoint: Optional[str] = None
    auth_type: Optional[str] = "api_key"
    additional_config: Optional[Dict[str, Any]] = None

class UpdateConnectorPayload(BaseModel):
    """Pydantic model for updating a connector."""
    api_url: Optional[str] = None
    api_key: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    endpoint: Optional[str] = None
    auth_type: Optional[str] = None
    additional_config: Optional[Dict[str, Any]] = None
    is_tested: Optional[bool] = None
