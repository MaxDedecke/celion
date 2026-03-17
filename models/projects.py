from pydantic import BaseModel
from typing import Optional

class Project(BaseModel):
    """Pydantic model for a project."""
    id: str
    name: str
    description: Optional[str] = None
    created_at: str

class CreateProjectPayload(BaseModel):
    """Pydantic model for creating a project."""
    name: str
    description: Optional[str] = None
    user_id: str

class UpdateProjectPayload(BaseModel):
    """Pydantic model for updating a project."""
    name: Optional[str] = None
    description: Optional[str] = None

class ProjectMember(BaseModel):
    """Pydantic model for a project member."""
    id: str
    project_id: str
    user_id: str
    role: str
    created_at: str

class CreateProjectMemberPayload(BaseModel):
    """Pydantic model for creating a project member."""
    project_id: str
    user_id: str
    role: str = "member"

class DataSourceProject(BaseModel):
    project_id: str
