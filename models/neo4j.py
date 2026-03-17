from pydantic import BaseModel
from typing import Optional, Dict, Any

class Neo4jQueryPayload(BaseModel):
    query: str
    params: Optional[Dict[str, Any]] = {}

class Neo4jVectorSearchPayload(BaseModel):
    migration_id: str
    query_text: str
    limit: Optional[int] = 5
    source_system: Optional[str] = None
