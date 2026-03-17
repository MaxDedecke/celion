from pydantic import BaseModel
from typing import Optional, Dict, Any, Union

class RunStepRequest(BaseModel):
    migrationId: str
    agentName: str
    agentParams: Optional[Dict[str, Any]] = None
    stepId: Optional[str] = None
    stepName: Optional[str] = None

class Migration(BaseModel):
    id: str
    name: str
    source_system: str
    target_system: str
    source_url: str
    target_url: str
    in_connector: Optional[str] = None
    in_connector_detail: Optional[str] = None
    out_connector: Optional[str] = None
    out_connector_detail: Optional[str] = None
    objects_transferred: Optional[str] = None
    mapped_objects: Optional[str] = None
    project_id: Optional[str] = None
    notes: Optional[str] = None
    scope_config: Optional[dict] = None
    workflow_state: Optional[dict] = None
    progress: Optional[float] = 0.0
    current_step: int = 0
    step_status: str = "idle"
    consultant_status: str = "idle"
    status: Optional[str] = "not_started"
    created_at: str
    updated_at: Optional[str] = None

class MigrationActivity(BaseModel):
    id: str
    migration_id: str
    type: str
    title: str
    timestamp: str
    created_at: Optional[str] = None

class MigrationStep(BaseModel):
    id: str
    migration_id: str
    workflow_step_id: str
    name: str
    status: str
    status_message: Optional[str] = None
    result: Optional[dict] = None
    created_at: str
    updated_at: Optional[str] = None

class MigrationChatMessage(BaseModel):
    id: str
    migration_id: str
    role: str
    content: str
    step_number: Optional[int] = None
    created_at: str

class CreateMigrationChatMessagePayload(BaseModel):
    role: str
    content: str
    step_number: Optional[int] = None

class AnswerAgentRequest(BaseModel):
    content: str

class MappingChatMessage(BaseModel):
    id: str
    migration_id: str
    role: str
    content: str
    created_at: str

class CreateMappingChatMessagePayload(BaseModel):
    role: str
    content: str

class MappingRule(BaseModel):
    id: str
    migration_id: str
    source_system: str
    source_object: str
    source_property: Optional[str] = None
    target_system: str
    target_object: str
    target_property: Optional[str] = None
    note: Optional[str] = None
    rule_type: str
    enhancements: Optional[list[str]] = []
    created_at: str

class CreateMappingRulePayload(BaseModel):
    source_system: str
    source_object: str
    source_property: str
    target_system: str
    target_object: str
    target_property: str
    note: Optional[str] = None
    rule_type: str
    enhancements: Optional[list[str]] = []

class UpdateMappingRulePayload(BaseModel):
    note: Optional[str] = None
    rule_type: Optional[str] = None
    enhancements: Optional[list[str]] = None

class StepTriggerParams(BaseModel):
    agent_params: Optional[Dict[str, Any]] = None

class CreateMigrationActivityPayload(BaseModel):
    migration_id: str
    type: str
    title: str
    timestamp: str

class CreateMigrationPayload(BaseModel):
    name: str
    source_system: str
    target_system: str
    source_url: str
    target_url: str
    project_id: Optional[str] = None
    user_id: str
    in_connector: str
    in_connector_detail: str
    out_connector: str
    out_connector_detail: str
    status: Optional[str] = "not_started"
    scope_config: Optional[dict] = None

class UpdateMigrationPayload(BaseModel):
    name: Optional[str] = None
    source_system: Optional[str] = None
    target_system: Optional[str] = None
    source_url: Optional[str] = None
    target_url: Optional[str] = None
    in_connector: Optional[str] = None
    in_connector_detail: Optional[str] = None
    out_connector: Optional[str] = None
    out_connector_detail: Optional[str] = None
    objects_transferred: Optional[str] = None
    mapped_objects: Optional[str] = None
    notes: Optional[str] = None
    scope_config: Optional[dict] = None
    workflow_state: Optional[dict] = None
    progress: Optional[int] = None

class UpdateResultPayload(BaseModel):
    step: int
    system_mode: Optional[str] = None
    entity_name: Optional[str] = None
    new_json: Dict[str, Any]
