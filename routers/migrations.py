import os
import json
import asyncio
from typing import Any, Optional, Dict, Union
from datetime import datetime, date, timezone
from fastapi import APIRouter, HTTPException, Response, WebSocket
import psycopg
import psycopg.rows
from starlette.concurrency import run_in_threadpool

from models.migrations import *
from core.database import get_db_connection, json_dumps
from core.rabbitmq import publish_to_rabbitmq
from core.neo4j_utils import duplicate_neo4j_data, delete_neo4j_data
from core.websocket import manager

router = APIRouter()
app = router

@router.get("/api/migration_steps", response_model=list[MigrationStep])
async def get_migration_steps(
    migration_id: str,
) -> list[MigrationStep]:
    """Fetch all steps for a given migration from the database."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            
            cur.execute(
                "SELECT id, migration_id, workflow_step_id, name, status, status_message, result, created_at, updated_at FROM public.migration_steps WHERE migration_id = %s ORDER BY created_at ASC",
                (migration_id,),
            )
            step_rows = cur.fetchall()

            steps = [
                MigrationStep(
                    id=str(row["id"]),
                    migration_id=str(row["migration_id"]),
                    workflow_step_id=row["workflow_step_id"],
                    name=row["name"],
                    status=row["status"],
                    status_message=row["status_message"],
                    result=row["result"],
                    created_at=row["created_at"].isoformat(),
                    updated_at=row["updated_at"].isoformat() if row["updated_at"] else None,
                )
                for row in step_rows
            ]
            
            return steps
            
    except Exception as exc:
        print(f"Error fetching migration steps: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch migration steps.") from exc


@router.get("/api/migrations/{id}/chat", response_model=list[MigrationChatMessage])
async def get_migration_chat_messages(id: str) -> list[MigrationChatMessage]:
    """Fetch all chat messages for a given migration."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, migration_id, role, content, step_number, created_at FROM public.migration_chat_messages WHERE migration_id = %s ORDER BY created_at ASC",
                (id,),
            )
            chat_rows = cur.fetchall()

            messages = [
                MigrationChatMessage(
                    id=str(row["id"]),
                    migration_id=str(row["migration_id"]),
                    role=row["role"],
                    content=row["content"],
                    step_number=row["step_number"],
                    created_at=row["created_at"].isoformat(),
                )
                for row in chat_rows
            ]
            return messages
    except Exception as exc:
        print(f"Error fetching migration chat messages: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch migration chat messages.") from exc



@router.post("/api/migrations/{id}/chat/answer")
async def ask_consultant(id: str, payload: AnswerAgentRequest) -> dict[str, Any]:
    """Ask the AI consultant or onboarding agent a question."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            # 0. Check current step
            cur.execute("SELECT current_step FROM public.migrations WHERE id = %s", (id,))
            mig_row = cur.fetchone()
            if not mig_row:
                raise HTTPException(status_code=404, detail="Migration not found.")
            
            current_step = mig_row["current_step"]

            # 1. Save user message
            cur.execute(
                """
                INSERT INTO public.migration_chat_messages (migration_id, role, content)
                VALUES (%s, 'user', %s)
                RETURNING id
                """,
                (id, payload.content),
            )
            user_msg_id = cur.fetchone()["id"]

            # Broadcast user message immediately
            import asyncio
            asyncio.create_task(manager.broadcast_to_migration(id, {
                "migration_id": id,
                "type": "chat_message_added",
                "data": {
                    "role": "user",
                    "content": payload.content,
                    "step_number": None
                }
            }))

            # 2. Fetch context (Step Results)
            step_results = {"step_1": [], "step_2": [], "step_3": [], "step_4": [], "step_5": [], "step_6": []}
            cur.execute("SELECT * FROM public.step_1_results WHERE migration_id = %s", (id,))
            step_results["step_1"] = [dict(row) for row in cur.fetchall()]
            cur.execute("SELECT * FROM public.step_2_results WHERE migration_id = %s", (id,))
            step_results["step_2"] = [dict(row) for row in cur.fetchall()]
            cur.execute("SELECT * FROM public.step_3_results WHERE migration_id = %s", (id,))
            step_results["step_3"] = [dict(row) for row in cur.fetchall()]
            cur.execute("SELECT * FROM public.step_4_results WHERE migration_id = %s", (id,))
            step_results["step_4"] = [dict(row) for row in cur.fetchall()]
            cur.execute("SELECT * FROM public.step_5_results WHERE migration_id = %s", (id,))
            step_results["step_5"] = [dict(row) for row in cur.fetchall()]
            cur.execute("SELECT * FROM public.step_6_results WHERE migration_id = %s", (id,))
            step_results["step_6"] = [dict(row) for row in cur.fetchall()]

            # 3. Fetch History (last 10 messages for follow-ups)
            cur.execute(
                """
                SELECT role, content FROM public.migration_chat_messages 
                WHERE migration_id = %s 
                AND role IN ('user', 'assistant')
                ORDER BY created_at DESC LIMIT 10
                """,
                (id,)
            )
            history = [{"role": row["role"], "content": row["content"]} for row in reversed(cur.fetchall())]

            # 4. Enqueue Job
            agent_name = "runIntroductionAgent" if current_step == 0 else "runAnswerAgent"
            agent_params = {
                "userMessage": payload.content,
                "context": {
                    "history": history
                }
            }
            if current_step != 0:
                agent_params["context"]["stepResults"] = step_results
            else:
                # For onboarding, include name
                cur.execute("SELECT name FROM public.migrations WHERE id = %s", (id,))
                name_row = cur.fetchone()
                if name_row:
                    agent_params["context"]["migrationName"] = name_row["name"]

            cur.execute(
                """
                INSERT INTO public.jobs (step_id, payload, status)
                VALUES (NULL, %s, 'pending')
                RETURNING id
                """,
                (json_dumps({
                    "migrationId": id,
                    "agentName": agent_name,
                    "agentParams": agent_params
                }),),
            )
            job_row = cur.fetchone()
            publish_to_rabbitmq(job_row["id"])
            
            conn.commit()
            return {"message": "Anfrage wurde übermittelt.", "jobId": job_row["id"]}

    except Exception as exc:
        print(f"Error enqueuing agent job: {exc}")
        raise HTTPException(status_code=500, detail="Fehler beim Senden der Anfrage.")


@router.post("/api/migrations/{id}/chat", response_model=MigrationChatMessage)
async def create_migration_chat_message(id: str, payload: CreateMigrationChatMessagePayload) -> MigrationChatMessage:
    """Create a new chat message for a given migration."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.migration_chat_messages (migration_id, role, content, step_number)
                VALUES (%s, %s, %s, %s)
                RETURNING id, migration_id, role, content, step_number, created_at
                """,
                (id, payload.role, payload.content, payload.step_number),
            )
            row = cur.fetchone()
            conn.commit()

            if not row:
                raise HTTPException(status_code=500, detail="Failed to create chat message.")

            # Broadcast message immediately
            import asyncio
            asyncio.create_task(manager.broadcast_to_migration(id, {
                "migration_id": id,
                "type": "chat_message_added",
                "data": {
                    "role": row["role"],
                    "content": row["content"],
                    "step_number": row["step_number"]
                }
            }))

            return MigrationChatMessage(
                id=str(row["id"]),
                migration_id=str(row["migration_id"]),
                role=row["role"],
                content=row["content"],
                step_number=row["step_number"],
                created_at=row["created_at"].isoformat(),
            )
    except Exception as exc:
        print(f"Error creating migration chat message: {exc}")
        raise HTTPException(status_code=500, detail="Failed to create migration chat message.") from exc








@router.get("/api/migrations/{id}/mapping-chat", response_model=list[MappingChatMessage])
async def get_mapping_chat_messages(id: str) -> list[MappingChatMessage]:
    """Fetch all mapping chat messages for a given migration."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, migration_id, role, content, created_at FROM public.mapping_chat_messages WHERE migration_id = %s ORDER BY created_at ASC",
                (id,),
            )
            chat_rows = cur.fetchall()

            messages = [
                MappingChatMessage(
                    id=str(row["id"]),
                    migration_id=str(row["migration_id"]),
                    role=row["role"],
                    content=row["content"],
                    created_at=row["created_at"].isoformat(),
                )
                for row in chat_rows
            ]
            return messages
    except Exception as exc:
        print(f"Error fetching mapping chat messages: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch mapping chat messages.") from exc





@router.get("/api/migrations/{id}/mapping-rules", response_model=list[MappingRule])
async def get_mapping_rules(id: str) -> list[MappingRule]:
    """Fetch all mapping rules for a given migration."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM public.mapping_rules WHERE migration_id = %s ORDER BY created_at DESC",
                (id,),
            )
            rows = cur.fetchall()
            return [
                MappingRule(
                    id=str(row["id"]),
                    migration_id=str(row["migration_id"]),
                    source_system=row["source_system"],
                    source_object=row["source_object"],
                    source_property=row.get("source_property"),
                    target_system=row["target_system"],
                    target_object=row["target_object"],
                    target_property=row.get("target_property"),
                    note=row.get("note"),
                    rule_type=row["rule_type"],
                    enhancements=row.get("enhancements") or [],
                    created_at=row["created_at"].isoformat(),
                )
                for row in rows
            ]
    except Exception as exc:
        print(f"Error fetching mapping rules: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch mapping rules.") from exc

@router.post("/api/migrations/{id}/mapping-rules", response_model=MappingRule)
async def create_mapping_rule(id: str, payload: CreateMappingRulePayload) -> MappingRule:
    """Create a new mapping rule."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.mapping_rules 
                (migration_id, source_system, source_object, source_property, target_system, target_object, target_property, note, rule_type, enhancements)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    id, 
                    payload.source_system, 
                    payload.source_object, 
                    payload.source_property,
                    payload.target_system, 
                    payload.target_object, 
                    payload.target_property,
                    payload.note,
                    payload.rule_type,
                    json.dumps(payload.enhancements) if payload.enhancements is not None else '[]'
                ),
            )
            row = cur.fetchone()
            conn.commit()
            
            return MappingRule(
                id=str(row["id"]),
                migration_id=str(row["migration_id"]),
                source_system=row["source_system"],
                source_object=row["source_object"],
                source_property=row.get("source_property"),
                target_system=row["target_system"],
                target_object=row["target_object"],
                target_property=row.get("target_property"),
                note=row.get("note"),
                rule_type=row["rule_type"],
                enhancements=row.get("enhancements") or [],
                created_at=row["created_at"].isoformat(),
            )
    except Exception as exc:
        print(f"Error creating mapping rule: {exc}")
        raise HTTPException(status_code=500, detail="Failed to create mapping rule.") from exc

@router.patch("/api/migrations/{id}/mapping-rules/{rule_id}", response_model=MappingRule)
async def patch_mapping_rule(id: str, rule_id: str, payload: UpdateMappingRulePayload) -> MappingRule:
    """Update an existing mapping rule."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            updates = []
            params = []
            if payload.note is not None:
                updates.append("note = %s")
                params.append(payload.note)
            if payload.rule_type is not None:
                updates.append("rule_type = %s")
                params.append(payload.rule_type)
            if payload.enhancements is not None:
                updates.append("enhancements = %s")
                params.append(json.dumps(payload.enhancements))
            
            if not updates:
                raise HTTPException(status_code=400, detail="No fields to update.")
            
            query = f"UPDATE public.mapping_rules SET {', '.join(updates)} WHERE id = %s AND migration_id = %s RETURNING *"
            params.extend([rule_id, id])
            
            cur.execute(query, tuple(params))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Mapping rule not found.")
            
            conn.commit()
            return MappingRule(
                id=str(row["id"]),
                migration_id=str(row["migration_id"]),
                source_system=row["source_system"],
                source_object=row["source_object"],
                source_property=row.get("source_property"),
                target_system=row["target_system"],
                target_object=row["target_object"],
                target_property=row.get("target_property"),
                note=row.get("note"),
                rule_type=row["rule_type"],
                enhancements=row.get("enhancements") or [],
                created_at=row["created_at"].isoformat(),
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error updating mapping rule: {exc}")
        raise HTTPException(status_code=500, detail="Failed to update mapping rule.") from exc

@router.delete("/api/migrations/{id}/mapping-rules/{rule_id}")
async def delete_mapping_rule(id: str, rule_id: str) -> dict[str, str]:
    """Delete an existing mapping rule."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM public.mapping_rules WHERE id = %s AND migration_id = %s RETURNING id", (rule_id, id))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Mapping rule not found.")
            conn.commit()
            return {"message": "Mapping rule deleted successfully."}
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error deleting mapping rule: {exc}")
        raise HTTPException(status_code=500, detail="Failed to delete mapping rule.") from exc


def _filter_id_fields(schema: dict[str, Any]) -> dict[str, Any]:
    """Remove fields that look like IDs from the schema to focus mapping on content."""
    if not schema or "objects" not in schema:
        return schema
    
    id_suffixes = ("_id", "Id", "Guid", "Uuid", "_guid", "_uuid")
    id_exact = ("id", "uuid", "guid", "pk", "_id", "external_id")
    
    filtered_objects = []
    for obj in schema["objects"]:
        filtered_obj = obj.copy()
        if "fields" in obj:
            filtered_obj["fields"] = [
                f for f in obj["fields"] 
                if f.get("id", "").lower() not in id_exact and 
                not f.get("id", "").endswith(id_suffixes)
            ]
        filtered_objects.append(filtered_obj)
    
    return {**schema, "objects": filtered_objects}

@router.post("/api/migrations/{id}/mapping-chat", response_model=MappingChatMessage)
async def create_mapping_chat_message(id: str, payload: CreateMappingChatMessagePayload) -> MappingChatMessage:
    """Create a new mapping chat message for a given migration."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            # 1. Save user message
            cur.execute(
                """
                INSERT INTO public.mapping_chat_messages (migration_id, role, content)
                VALUES (%s, %s, %s)
                RETURNING id, migration_id, role, content, created_at
                """,
                (id, payload.role, payload.content),
            )
            row = cur.fetchone()
            
            # 2. Prepare Context for Agent
            # Current Mappings from Step 6
            cur.execute("SELECT raw_json FROM public.step_6_results WHERE migration_id = %s", (id,))
            step6_row = cur.fetchone()
            current_mappings = step6_row['raw_json'].get('mappings', []) if step6_row and step6_row['raw_json'] else []
            
            # Get Migration details (Source/Target Systems)
            cur.execute("SELECT source_system, target_system, scope_config FROM public.migrations WHERE id = %s", (id,))
            migration_info = cur.fetchone()
            source_system = migration_info["source_system"] if migration_info else None
            target_system = migration_info["target_system"] if migration_info else None
            scope_config = migration_info["scope_config"] if migration_info else {}
            execution_plan = scope_config.get("execution_plan") if scope_config else None

            # Load Schemas
            import re
            
            source_schema = {}
            if source_system:
                norm_source = "".join(re.findall(r"[a-z0-9]", source_system.lower()))
                source_path = os.path.join(os.getcwd(), "schemes", "objects", f"{norm_source}_objects.json")
                if os.path.exists(source_path):
                    with open(source_path, "r", encoding="utf-8") as f:
                        source_schema = _filter_id_fields(json.load(f))

            target_schema = {}
            if target_system:
                norm_target = "".join(re.findall(r"[a-z0-9]", target_system.lower()))
                target_path = os.path.join(os.getcwd(), "schemes", "objects", f"{norm_target}_objects.json")
                if os.path.exists(target_path):
                    with open(target_path, "r", encoding="utf-8") as f:
                        target_schema = _filter_id_fields(json.load(f))

            # Source Entities from Step 3
            cur.execute("SELECT entity_name as name, count FROM public.step_3_results WHERE migration_id = %s", (id,))
            user_related_terms = ['user', 'member', 'participant', 'assignee', 'owner', 'creator', 'author', 'collaborator']
            source_entities = [
                dict(r) for r in cur.fetchall() 
                if r['count'] > 0 and not any(term in r['name'].lower() for term in user_related_terms)
            ]
            
            # Target Entities (Try Step 4 writable_entities or fallback)
            cur.execute("SELECT writable_entities FROM public.step_4_results WHERE migration_id = %s", (id,))
            step4_row = cur.fetchone()
            target_entity_names = step4_row['writable_entities'] if step4_row and step4_row['writable_entities'] else []
            target_entities = [{"name": name} for name in target_entity_names]
            
            # History
            cur.execute(
                """
                SELECT role, content FROM public.mapping_chat_messages 
                WHERE migration_id = %s 
                ORDER BY created_at DESC LIMIT 10
                """,
                (id,)
            )
            history = [{"role": r["role"], "content": r["content"]} for r in reversed(cur.fetchall())]

            # 3. Fetch current migration step to decide which agent to run
            cur.execute("SELECT current_step, step_status FROM public.migrations WHERE id = %s", (id,))
            mig_row = cur.fetchone()
            current_step = mig_row["current_step"] if mig_row else 0
            step_status = mig_row["step_status"] if mig_row else "idle"

            # 4. Enqueue Job for Rules Agent
            if payload.role == 'user':
                # Use Enhancement Agent if we are at step 5 (Enhancement)
                # If we are at step 4, we use Mapping Rules Agent (even if completed due to planning phase)
                is_enhancement_phase = (current_step == 5)
                agent_name = "runEnhancementRules" if is_enhancement_phase else "runMappingRules"
                
                # Fetch current rules for context
                cur.execute("SELECT * FROM public.mapping_rules WHERE migration_id = %s", (id,))
                current_rules = [dict(r) for r in cur.fetchall()]

                agent_params = {
                    "userMessage": payload.content,
                    "context": {
                        "sourceEntities": source_entities,
                        "sourceSchema": source_schema,
                        "history": history,
                        "migrationId": id,
                        "executionPlan": execution_plan
                    }
                }

                if is_enhancement_phase:
                    # Filter only MAP rules for enhancement context
                    agent_params["context"]["currentEnhancements"] = [r for r in current_rules if r.get("rule_type") == 'MAP']
                else:
                    agent_params["context"]["currentMappings"] = current_mappings
                    agent_params["context"]["targetEntities"] = target_entities
                    agent_params["context"]["targetSchema"] = target_schema

                cur.execute(
                    """
                    INSERT INTO public.jobs (step_id, payload, status)
                    VALUES (NULL, %s, 'pending')
                    RETURNING id
                    """,
                    (json_dumps({
                        "migrationId": id,
                        "agentName": agent_name,
                        "agentParams": agent_params
                    }),),
                )
                job_row = cur.fetchone()
                publish_to_rabbitmq(job_row["id"])
            
            conn.commit()

            if not row:
                raise HTTPException(status_code=500, detail="Failed to create mapping chat message.")

            return MappingChatMessage(
                id=str(row["id"]),
                migration_id=str(row["migration_id"]),
                role=row["role"],
                content=row["content"],
                created_at=row["created_at"].isoformat(),
            )
    except Exception as exc:
        print(f"Error creating mapping chat message: {exc}")
        raise HTTPException(status_code=500, detail="Failed to create mapping chat message.") from exc




@router.post("/api/migrations/{id}/action/{step}")
async def trigger_migration_step(id: str, step: int, params: Optional[StepTriggerParams] = None) -> dict[str, Any]:
    """Trigger a specific step in the migration process."""
    if not 1 <= step <= 8:
        raise HTTPException(status_code=400, detail="Step number must be between 1 and 8.")

    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            # 1. Update migration status and fetch details
            cur.execute(
                """
                UPDATE public.migrations
                SET current_step = %s, step_status = 'running', status = 'processing'
                WHERE id = %s
                RETURNING id, source_url, source_system, target_url, target_system, notes, workflow_state
                """,
                (step, id),
            )
            migration_row = cur.fetchone()
            if not migration_row:
                raise HTTPException(status_code=404, detail="Migration not found")

            # --- Workflow State Consistency ---
            # Remove nodes from workflow_state that correspond to the retried step or later steps.
            wf_state = migration_row.get("workflow_state") or {}
            if "nodes" in wf_state and isinstance(wf_state["nodes"], list):
                new_nodes = []
                step_map = {
                    "schema-discovery": 1,
                    "target-schema": 2,
                    "data-staging": 3,
                    "mapping-verification": 4,
                    "quality-enhancement": 5,
                    "data-transfer": 6,
                    "verification": 7,
                    "report": 8
                }
                
                for node in wf_state["nodes"]:
                     node_id = node.get("id", "")
                     keep = True
                     
                     # Check named IDs
                     if node_id in step_map:
                         if step_map[node_id] >= step:
                             keep = False
                     
                     # Check step-N IDs
                     elif node_id.startswith("step-"):
                         try:
                             node_step_num = int(node_id.split("-")[1])
                             if node_step_num >= step:
                                 keep = False
                         except ValueError:
                             pass
                     
                     if keep:
                         new_nodes.append(node)

                wf_state["nodes"] = new_nodes
                # Update workflow_state in DB
                cur.execute(
                    "UPDATE public.migrations SET workflow_state = %s WHERE id = %s",
                    (json.dumps(wf_state), id)
                )

            # 2. Create a migration_step record
            workflow_step_mapping = {
                1: ("schema-discovery", "Source Discovery"),
                2: ("target-schema", "Target Discovery"),
                3: ("data-staging", "Data Staging"),
                4: ("mapping-verification", "Mapping Verification"),
                5: ("quality-enhancement", "Quality Enhancement"),
                6: ("data-transfer", "Data Transfer"),
                7: ("verification", "Verification"),
                8: ("report", "Report"),
            }
            
            workflow_step_id, step_name = workflow_step_mapping.get(step, (f"step-{step}", f"Step {step}"))

            # --- Consistency Rollback ---
            # If we are re-running an earlier step, we must clear results of all subsequent steps
            # to maintain data integrity.
            # ONLY do this if we are not just providing input (i.e. params.agent_params is None)
            
            is_continuation = params is not None and params.agent_params is not None

            if not is_continuation:
                # 1. Clear structured results for steps >= this step
                # Step 1 (Source Discovery) -> Inventory (step_3_results)
                if step <= 1:
                    cur.execute("DELETE FROM public.step_3_results WHERE migration_id = %s", (id,))
                # Step 2 (Target Discovery) -> step_4_results
                if step <= 2:
                    cur.execute("DELETE FROM public.step_4_results WHERE migration_id = %s", (id,))
                # Step 3 (Data Staging) -> step_5_results
                if step <= 3:
                    cur.execute("DELETE FROM public.step_5_results WHERE migration_id = %s", (id,))
                # Step 4 (Mapping Verification) -> step_6_results
                if step <= 4:
                    cur.execute("DELETE FROM public.step_6_results WHERE migration_id = %s", (id,))
                # Step 5 (Quality Enhancement) -> step_7_results
                if step <= 5:
                    cur.execute("DELETE FROM public.step_7_results WHERE migration_id = %s", (id,))
                # Step 6 (Data Transfer) -> step_8_results
                if step <= 6:
                    cur.execute("DELETE FROM public.step_8_results WHERE migration_id = %s", (id,))
                # Step 7 (Verification) -> step_9_results
                if step <= 7:
                    cur.execute("DELETE FROM public.step_9_results WHERE migration_id = %s", (id,))
                # Step 8 (Report) -> step_10_results
                if step <= 8:
                    cur.execute("DELETE FROM public.step_10_results WHERE migration_id = %s", (id,))
                
                # 2. Reset overall migration complexity if step 1 is retried
                if step <= 1:
                    cur.execute("UPDATE public.migrations SET complexity_score = 0 WHERE id = %s", (id,))

                # 3. Clear/Reset migration_steps for all steps >= current retry step
                # Match both step-N and named IDs
                cur.execute(
                    """
                    DELETE FROM public.migration_steps 
                    WHERE migration_id = %s 
                    AND (
                        (workflow_step_id ~ '^step-[0-9]+$' AND CAST(substring(workflow_step_id from 6) AS INTEGER) >= %s)
                        OR
                        (workflow_step_id IN ('schema-discovery') AND %s <= 1)
                        OR
                        (workflow_step_id IN ('target-schema') AND %s <= 2)
                        OR
                        (workflow_step_id IN ('data-staging') AND %s <= 3)
                        OR
                        (workflow_step_id IN ('mapping-verification') AND %s <= 4)
                        OR
                        (workflow_step_id IN ('quality-enhancement') AND %s <= 5)
                        OR
                        (workflow_step_id IN ('data-transfer') AND %s <= 6)
                        OR
                        (workflow_step_id IN ('verification') AND %s <= 7)
                        OR
                        (workflow_step_id IN ('report') AND %s <= 8)
                    )
                    """,
                    (id, step, step, step, step, step, step, step, step, step),
                )

                # 4. Clear chat messages from this step onwards
                # cur.execute(
                #     """
                #     DELETE FROM public.migration_chat_messages 
                #     WHERE migration_id = %s 
                #     AND step_number >= %s
                #     """,
                #     (id, step),
                # )

            # 5. Reset migration current_step if needed
            cur.execute(
                "UPDATE public.migrations SET current_step = %s WHERE id = %s",
                (step, id)
            )

            # 6. Create new pending step record
            cur.execute(
                """
                INSERT INTO public.migration_steps (migration_id, workflow_step_id, name, status)
                VALUES (%s, %s, %s, 'pending')
                ON CONFLICT (migration_id, workflow_step_id) DO UPDATE
                SET status = 'pending', status_message = NULL, result = NULL, updated_at = now()
                RETURNING id
                """,
                (id, workflow_step_id, step_name),
            )
            step_row = cur.fetchone()
            if not step_row:
                raise HTTPException(status_code=500, detail="Failed to create migration step.")
            
            step_id = step_row["id"]

            # 3. Enqueue job for the worker
            step_agent_mapping = {
                1: "runCapabilityDiscovery",
                2: "runTargetSchema",
                3: "runDataStaging",
                4: "runMappingVerification",
                5: "runQualityEnhancement",
                6: "runDataTransfer",
                7: "runVerification",
                8: "runReport",
            }
            agent_name = step_agent_mapping.get(step, "runCapabilityDiscovery")

            payload_base = {
                "migrationId": id,
                "stepId": str(step_id),
                "stepNumber": step,
                "agentName": agent_name,
            }

            agent_params = {
                "sourceUrl": migration_row["source_url"],
                "sourceExpectedSystem": migration_row["source_system"],
                "targetUrl": migration_row["target_url"],
                "targetExpectedSystem": migration_row["target_system"],
                "instructions": migration_row["notes"],
            }
            
            # Merge extra params if provided
            if params and params.agent_params:
                agent_params.update(params.agent_params)

            payload = {
                **payload_base,
                "agentParams": agent_params,
            }
            cur.execute(
                "INSERT INTO public.jobs (step_id, payload, status) VALUES (%s, %s, 'pending')",
                (step_id, json.dumps(payload)),
            )

            # We need to publish to RabbitMQ for EACH job created in this turn
            cur.execute("SELECT id FROM public.jobs WHERE step_id = %s AND status = 'pending'", (step_id,))
            job_rows = cur.fetchall()
            for job_row in job_rows:
                publish_to_rabbitmq(job_row["id"])
            
            conn.commit()

            return {
                "stepId": step_id,
                "message": f"Step {step} has been enqueued with {len(job_rows)} jobs",
            }
    except HTTPException:
        raise
    except Exception as exc:
        # Rollback in case of error
        with get_db_connection() as conn:
            conn.rollback()
        # Revert status
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE public.migrations SET step_status = 'failed', status = 'paused' WHERE id = %s",
                (id,),
            )
            conn.commit()
        raise HTTPException(status_code=500, detail=str(exc)) from exc









@router.post("/api/migrations", response_model=Migration)
async def create_migration(payload: CreateMigrationPayload) -> Migration:
    """Create a new migration in the database."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.migrations (
                    name, source_system, target_system, source_url, target_url, 
                    project_id, user_id, in_connector, in_connector_detail, 
                    out_connector, out_connector_detail, status, scope_config,
                    current_step, step_status
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'not_started', %s, 0, 'idle')
                RETURNING id, name, source_system, target_system, source_url, target_url, in_connector, in_connector_detail, out_connector, out_connector_detail, objects_transferred, mapped_objects, project_id, notes, workflow_state, progress, current_step, step_status, consultant_status, status, created_at, updated_at, scope_config
                """,
                (
                    payload.name,
                    payload.source_system,
                    payload.target_system,
                    payload.source_url,
                    payload.target_url,
                    payload.project_id,
                    payload.user_id,
                    payload.in_connector,
                    payload.in_connector_detail,
                    payload.out_connector,
                    payload.out_connector_detail,
                    json.dumps(payload.scope_config) if payload.scope_config else None,
                ),
            )
            row = cur.fetchone()
            
            if not row:
                raise HTTPException(status_code=500, detail="Failed to create migration.")

            migration_id = str(row["id"])

            # 1. Create a dedicated onboarding step record
            cur.execute(
                """
                INSERT INTO public.migration_steps (migration_id, workflow_step_id, name, status)
                VALUES (%s, 'onboarding', 'Einrichtung', 'completed')
                RETURNING id
                """,
                (migration_id,),
            )
            onboarding_step_id = cur.fetchone()["id"]

            # 2. Enqueue Job for Introduction
            cur.execute(
                """
                INSERT INTO public.jobs (step_id, payload, status)
                VALUES (%s, %s, 'pending')
                RETURNING id
                """,
                (onboarding_step_id, json_dumps({
                    "migrationId": migration_id,
                    "agentName": "runIntroductionAgent",
                    "agentParams": {
                        "userMessage": "Hallo! Ich möchte eine neue Migration starten.",
                        "context": {
                            "history": [],
                            "migrationName": payload.name
                        }
                    }
                }),),
            )
            job_row = cur.fetchone()
            if job_row:
                publish_to_rabbitmq(job_row["id"])

            conn.commit()

            return Migration(
                id=str(row["id"]),
                name=row["name"],
                source_system=row["source_system"],
                target_system=row["target_system"],
                source_url=row["source_url"],
                target_url=row["target_url"],
                in_connector=row["in_connector"],
                in_connector_detail=row["in_connector_detail"],
                out_connector=row["out_connector"],
                out_connector_detail=row["out_connector_detail"],
                objects_transferred=row["objects_transferred"],
                mapped_objects=row["mapped_objects"],
                project_id=str(row["project_id"]) if row["project_id"] else None,
                notes=row["notes"],
                scope_config=row["scope_config"],
                workflow_state=row["workflow_state"],
                progress=row["progress"],
                current_step=row["current_step"],
                step_status=row["step_status"],
                consultant_status=row["consultant_status"],
                status=row["status"],
                created_at=row["created_at"].isoformat(),
                updated_at=row["updated_at"].isoformat() if row["updated_at"] else None,
            )
    except Exception as exc:
        print(f"Error creating migration: {exc}")
        raise HTTPException(status_code=500, detail="Failed to create migration.") from exc


@router.post(
    "/api/migration_activities",
    response_model=Union[MigrationActivity, list[MigrationActivity]],
)
async def insert_migration_activity(
    payload: Union[CreateMigrationActivityPayload, list[CreateMigrationActivityPayload]]
) -> Union[MigrationActivity, list[MigrationActivity]]:
    """Insert one or many migration activities into the database."""

    def _insert_activity(cur: psycopg.Cursor, item: CreateMigrationActivityPayload) -> dict[str, Any]:
        cur.execute(
            """
            INSERT INTO public.migration_activities (migration_id, type, title, timestamp)
            VALUES (%s, %s, %s, %s)
            RETURNING id, migration_id, type, title, timestamp, created_at
            """,
            (item.migration_id, item.type, item.title, item.timestamp),
        )
        return cur.fetchone()

    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            items = payload if isinstance(payload, list) else [payload]
            inserted_rows = [_insert_activity(cur, item) for item in items]
            conn.commit()

            activities = [
                MigrationActivity(
                    id=str(row["id"]),
                    migration_id=str(row["migration_id"]),
                    type=row["type"],
                    title=row["title"],
                    timestamp=str(row["timestamp"]),
                    created_at=row["created_at"].isoformat()
                    if hasattr(row["created_at"], "isoformat")
                    else str(row["created_at"])
                    if row["created_at"]
                    else None,
                )
                for row in inserted_rows
            ]

            if isinstance(payload, list):
                return activities

            return activities[0]
    except Exception as exc:
        print(f"Error inserting migration activity: {exc}")
        raise HTTPException(status_code=500, detail="Failed to insert migration activity.") from exc


@router.get("/api/migration_activities", response_model=list[MigrationActivity])
async def get_migration_activities(
    response: Response,
    migration_id: Optional[str] = None,
    limit: int = 15,
    offset: int = 0,
) -> list[MigrationActivity]:
    """Fetch migration activities from the database, optionally filtered by migration_id."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            count_query = "SELECT COUNT(*) FROM public.migration_activities"
            query = "SELECT id, migration_id, type, title, timestamp, created_at FROM public.migration_activities"

            params = []
            where_clause = ""

            if migration_id:
                if migration_id.startswith("eq."):
                    where_clause = " WHERE migration_id = %s"
                    params.append(migration_id.replace("eq.", ""))
                else: # fallback for just id
                    where_clause = " WHERE migration_id = %s"
                    params.append(migration_id)
            
            count_query += where_clause
            query += where_clause

            cur.execute(count_query, tuple(params))
            count_result = cur.fetchone()
            total_count = count_result['count'] if count_result else 0

            query += " ORDER BY timestamp DESC LIMIT %s OFFSET %s"
            params.extend([limit, offset])

            cur.execute(query, tuple(params))
            activity_rows = cur.fetchall()

            activities = [
                MigrationActivity(
                    id=str(row["id"]),
                    migration_id=str(row["migration_id"]),
                    type=row["type"],
                    title=row["title"],
                    timestamp=str(row["timestamp"]),
                    created_at=row["created_at"].isoformat()
                    if hasattr(row["created_at"], "isoformat")
                    else str(row["created_at"])
                    if row["created_at"]
                    else None,
                )
                for row in activity_rows
            ]

            response.headers["X-Total-Count"] = str(total_count)

            return activities
    except Exception as exc:
        print(f"Error fetching migration activities: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch migration activities.") from exc


@router.get("/api/migrations", response_model=list[Migration])
async def get_migrations(
    response: Response,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    limit: int = 15,
    offset: int = 0,
) -> list[Migration]:
    """Fetch migrations from the database with user-based visibility."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            
            base_select = "SELECT m.id, m.name, m.source_system, m.target_system, m.source_url, m.target_url, m.in_connector, m.in_connector_detail, m.out_connector, m.out_connector_detail, m.objects_transferred, m.mapped_objects, m.project_id, m.notes, m.scope_config, m.workflow_state, m.progress, m.current_step, m.step_status, m.consultant_status, m.status, m.created_at, m.updated_at FROM public.migrations m"
            
            conditions = []
            params = []
            
            # Handle project_id filter
            if project_id:
                if project_id == "is.null":
                    conditions.append("m.project_id IS NULL")
                    # For standalone migrations, only show user's own
                    if user_id:
                        conditions.append("m.user_id = %s")
                        params.append(user_id)
                elif project_id.startswith("eq."):
                    conditions.append("m.project_id = %s")
                    params.append(project_id.replace("eq.", ""))
                else:
                    conditions.append("m.project_id = %s")
                    params.append(project_id)
            elif user_id:
                # No project_id filter: show user's standalone migrations + migrations in projects they can access
                conditions.append("""(
                    (m.project_id IS NULL AND m.user_id = %s)
                    OR m.project_id IN (
                        SELECT p.id FROM public.projects p WHERE p.user_id = %s
                        UNION
                        SELECT pm.project_id FROM public.project_members pm WHERE pm.user_id = %s
                    )
                )""")
                params.extend([user_id, user_id, user_id])
            
            where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""
            
            count_query = f"SELECT COUNT(*) FROM public.migrations m{where_clause}"
            cur.execute(count_query, tuple(params))
            count_result = cur.fetchone()
            total_count = count_result['count'] if count_result else 0
            
            query = f"{base_select}{where_clause} ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC LIMIT %s OFFSET %s"
            params.extend([limit, offset])

            cur.execute(query, tuple(params))
            migration_rows = cur.fetchall()

            migrations = []
            for row in migration_rows:
                try:
                    # Robust date serialization
                    created_at_str = ""
                    if isinstance(row["created_at"], (datetime, date)):
                        created_at_str = row["created_at"].isoformat()
                    else:
                        created_at_str = str(row["created_at"]) if row["created_at"] else ""

                    updated_at_str = None
                    if row.get("updated_at"):
                        if isinstance(row["updated_at"], (datetime, date)):
                            updated_at_str = row["updated_at"].isoformat()
                        else:
                            updated_at_str = str(row["updated_at"])

                    migrations.append(Migration(
                        id=str(row["id"]),
                        name=row["name"],
                        source_system=row["source_system"],
                        target_system=row["target_system"],
                        source_url=row.get("source_url") or "",
                        target_url=row.get("target_url") or "",
                        in_connector=row.get("in_connector"),
                        in_connector_detail=row.get("in_connector_detail"),
                        out_connector=row.get("out_connector"),
                        out_connector_detail=row.get("out_connector_detail"),
                        objects_transferred=row.get("objects_transferred"),
                        mapped_objects=row.get("mapped_objects"),
                        project_id=str(row["project_id"]) if row.get("project_id") else None,
                        notes=row.get("notes"),
                        scope_config=row.get("scope_config"),
                        workflow_state=row.get("workflow_state"),
                        progress=float(row["progress"]) if row.get("progress") is not None else 0.0,
                        current_step=int(row["current_step"]) if row.get("current_step") is not None else 0,
                        step_status=row.get("step_status") or "idle",
                        consultant_status=row.get("consultant_status") or "idle",
                        status=row.get("status") or "not_started",
                        created_at=created_at_str,
                        updated_at=updated_at_str,
                    ))
                except Exception as row_err:
                    print(f"Error serializing migration row {row.get('id')}: {row_err}")
                    continue
            
            response.headers["X-Total-Count"] = str(total_count)
            return migrations
            
    except Exception as exc:
        print(f"Error fetching migrations: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch migrations.") from exc


@router.get("/api/migrations/{id}", response_model=Migration)
async def get_migration(id: str) -> Migration:
    """Fetch a single migration from the database."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, source_system, target_system, source_url, target_url, in_connector, in_connector_detail, out_connector, out_connector_detail, objects_transferred, mapped_objects, project_id, notes, scope_config, workflow_state, progress, current_step, step_status, consultant_status, status, created_at, updated_at FROM public.migrations WHERE id = %s",
                (id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Migration not found.")

            return Migration(
                id=str(row["id"]),
                name=row["name"],
                source_system=row["source_system"],
                target_system=row["target_system"],
                source_url=row["source_url"],
                target_url=row["target_url"],
                in_connector=row["in_connector"],
                in_connector_detail=row["in_connector_detail"],
                out_connector=row["out_connector"],
                out_connector_detail=row["out_connector_detail"],
                objects_transferred=row["objects_transferred"],
                mapped_objects=row["mapped_objects"],
                project_id=str(row["project_id"]) if row["project_id"] else None,
                notes=row["notes"],
                scope_config=row["scope_config"],
                workflow_state=row["workflow_state"],
                progress=row["progress"],
                current_step=row["current_step"],
                step_status=row["step_status"],
                consultant_status=row["consultant_status"],
                status=row["status"],
                created_at=row["created_at"].isoformat(),
                updated_at=row["updated_at"].isoformat() if row["updated_at"] else None,
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching migration: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch migration.") from exc





async def duplicate_neo4j_data(old_id: str, new_id: str):
    """Clone all nodes and relationships from one migration to another in Neo4j."""
    driver = _get_neo4j_driver()
    try:
        with driver.session() as session:
            # 1. Fetch all nodes for the old migration
            result = session.run(
                "MATCH (n {migration_id: $oldId}) RETURN labels(n) as labels, properties(n) as props",
                oldId=old_id
            )
            nodes = list(result)
            
            # 2. Create new nodes for the new migration
            for record in nodes:
                labels = record["labels"]
                props = dict(record["props"])
                props["migration_id"] = str(new_id)
                
                # Dynamic label creation in Cypher
                label_str = ":".join([f"`{l}`" for l in labels])
                query = f"CREATE (n:{label_str}) SET n = $props"
                session.run(query, props=props)
            
            # 3. Fetch and duplicate relationships
            # Note: This assumes relationships only exist between nodes of the same migration
            rel_result = session.run(
                """
                MATCH (s {migration_id: $oldId})-[r]->(t {migration_id: $oldId})
                RETURN labels(s) as sLabels, s.external_id as sExt, 
                       labels(t) as tLabels, t.external_id as tExt, 
                       type(r) as relType, properties(r) as relProps
                """,
                oldId=old_id
            )
            
            for rel in rel_result:
                s_labels = ":".join([f"`{l}`" for l in rel["sLabels"]])
                t_labels = ":".join([f"`{l}`" for l in rel["tLabels"]])
                
                query = f"""
                    MATCH (s:{s_labels} {{external_id: $sExt, migration_id: $newId}})
                    MATCH (t:{t_labels} {{external_id: $tExt, migration_id: $newId}})
                    CREATE (s)-[r:`{rel["relType"]}`]->(t)
                    SET r = $relProps
                """
                session.run(query, sExt=rel["sExt"], tExt=rel["tExt"], newId=str(new_id), relProps=rel["relProps"])
                
    except Exception as e:
        print(f"Error duplicating Neo4j data: {e}", file=sys.stderr)
    finally:
        driver.close()


async def delete_neo4j_data(migration_id: str):
    """Delete all nodes and relationships associated with a migration in Neo4j."""
    driver = _get_neo4j_driver()
    try:
        with driver.session() as session:
            # DETACH DELETE ensures relationships are also removed
            session.run(
                "MATCH (n {migration_id: $id}) DETACH DELETE n",
                id=migration_id
            )
    except Exception as e:
        print(f"Error deleting Neo4j data: {e}", file=sys.stderr)
    finally:
        driver.close()





@router.patch("/api/migrations/{id}", response_model=Migration)
async def update_migration(id: str, payload: UpdateMigrationPayload) -> Migration:
    """Update a migration in the database."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            updates: list[str] = []
            params: list[Any] = []
            
            payload_dict = payload.model_dump(exclude_none=True)
            for field, value in payload_dict.items():
                updates.append(f"{field} = %s")
                if isinstance(value, dict):
                    params.append(json.dumps(value))
                else:
                    params.append(value)
            
            if not updates:
                raise HTTPException(status_code=400, detail="No fields to update.")
            
            updates.append("updated_at = now()")
            params.append(id)

            query = f"""
                UPDATE public.migrations
                SET {", ".join(updates)}
                WHERE id = %s
                RETURNING id, name, source_system, target_system, source_url, target_url, in_connector, in_connector_detail, out_connector, out_connector_detail, objects_transferred, mapped_objects, project_id, notes, scope_config, workflow_state, progress, current_step, step_status, consultant_status, status, created_at, updated_at
            """
            
            cur.execute(query, tuple(params))
            row = cur.fetchone()
            conn.commit()
            
            if not row:
                raise HTTPException(status_code=404, detail="Migration not found.")
            
            return Migration(
                id=str(row["id"]),
                name=row["name"],
                source_system=row["source_system"],
                target_system=row["target_system"],
                source_url=row["source_url"],
                target_url=row["target_url"],
                in_connector=row["in_connector"],
                in_connector_detail=row["in_connector_detail"],
                out_connector=row["out_connector"],
                out_connector_detail=row["out_connector_detail"],
                objects_transferred=row["objects_transferred"],
                mapped_objects=row["mapped_objects"],
                project_id=str(row["project_id"]) if row["project_id"] else None,
                notes=row["notes"],
                scope_config=row["scope_config"],
                workflow_state=row["workflow_state"],
                progress=row["progress"],
                current_step=row["current_step"],
                step_status=row["step_status"],
                consultant_status=row["consultant_status"],
                status=row["status"],
                created_at=row["created_at"].isoformat(),
                updated_at=row["updated_at"].isoformat() if row["updated_at"] else None,
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error updating migration: {exc}")
        raise HTTPException(status_code=500, detail="Failed to update migration.") from exc

@router.post("/api/migrations/{id}/duplicate", response_model=Migration)
async def duplicate_migration(id: str, user_id: str) -> Migration:
    """Duplicate a migration, creating a new one with copied data and full state."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            # 1. Fetch original with all state fields
            cur.execute(
                """
                SELECT name, source_system, target_system, source_url, target_url, 
                       in_connector, in_connector_detail, out_connector, out_connector_detail, 
                       project_id, notes, scope_config,
                       current_step, step_status, status, progress, workflow_state,
                       objects_transferred, mapped_objects
                FROM public.migrations WHERE id = %s
                """,
                (id,),
            )
            original = cur.fetchone()
            if not original:
                raise HTTPException(status_code=404, detail="Migration not found.")

            # 2. Create new migration with preserved state
            new_name = f"{original['name']} (copy)"
            
            # Handle JSON fields serialization
            workflow_state_json = json.dumps(original["workflow_state"]) if original["workflow_state"] else None
            scope_config_json = json.dumps(original["scope_config"]) if original["scope_config"] else None

            # Map all fields explicitly to avoid counting errors
            fields = [
                "name", "source_system", "target_system", "source_url", "target_url",
                "project_id", "user_id", "in_connector", "in_connector_detail",
                "out_connector", "out_connector_detail", "notes", "scope_config",
                "current_step", "step_status", "status", "progress", "workflow_state",
                "objects_transferred", "mapped_objects"
            ]
            
            params = [
                new_name, original["source_system"], original["target_system"], 
                original["source_url"], original["target_url"], original["project_id"], 
                user_id, original["in_connector"], original["in_connector_detail"], 
                original["out_connector"], original["out_connector_detail"], 
                original["notes"], scope_config_json, original["current_step"], 
                original["step_status"], original["status"], original["progress"], 
                workflow_state_json, original["objects_transferred"], original["mapped_objects"]
            ]

            placeholders = ", ".join(["%s"] * len(fields))
            columns = ", ".join(fields)

            query = f"""
                INSERT INTO public.migrations ({columns})
                VALUES ({placeholders})
                RETURNING id, name, source_system, target_system, source_url, target_url, 
                          in_connector, in_connector_detail, out_connector, out_connector_detail, 
                          objects_transferred, mapped_objects, project_id, notes, scope_config, 
                          workflow_state, progress, current_step, step_status, consultant_status, status, created_at, updated_at
            """

            cur.execute(query, tuple(params))
            row = cur.fetchone()
            new_migration_id = row["id"]

            # 3. Duplicate connectors
            cur.execute(
                """
                INSERT INTO public.connectors (
                    migration_id, connector_type, api_url, api_key, username, 
                    password, endpoint, additional_config, auth_type, is_tested
                )
                SELECT %s, connector_type, api_url, api_key, username, 
                       password, endpoint, additional_config, auth_type, is_tested
                FROM public.connectors WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            # 3b. Duplicate Step 1-4 results
            cur.execute(
                """
                INSERT INTO public.step_1_results (
                    migration_id, system_mode, detected_system, confidence_score, 
                    api_type, api_subtype, recommended_base_url, raw_json
                )
                SELECT %s, system_mode, detected_system, confidence_score, 
                       api_type, api_subtype, recommended_base_url, raw_json
                FROM public.step_1_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            cur.execute(
                """
                INSERT INTO public.step_2_results (
                    migration_id, system_mode, is_authenticated, auth_type, 
                    error_message, raw_json
                )
                SELECT %s, system_mode, is_authenticated, auth_type, 
                       error_message, raw_json
                FROM public.step_2_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            cur.execute(
                """
                INSERT INTO public.step_3_results (
                    migration_id, entity_name, count, complexity, 
                    error_message, raw_json
                )
                SELECT %s, entity_name, count, complexity, 
                       error_message, raw_json
                FROM public.step_3_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            cur.execute(
                """
                INSERT INTO public.step_4_results (
                    migration_id, target_scope_id, target_scope_name, target_status, 
                    writable_entities, missing_permissions, summary, raw_json
                )
                SELECT %s, target_scope_id, target_scope_name, target_status, 
                       writable_entities, missing_permissions, summary, raw_json
                FROM public.step_4_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            # 3c. Duplicate Step 5 results
            cur.execute(
                """
                INSERT INTO public.step_5_results (
                    migration_id, summary, raw_json
                )
                SELECT %s, summary, raw_json
                FROM public.step_5_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            cur.execute(
                """
                INSERT INTO public.step_6_results (
                    migration_id, summary, raw_json
                )
                SELECT %s, summary, raw_json
                FROM public.step_6_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            cur.execute(
                """
                INSERT INTO public.step_7_results (
                    migration_id, summary, raw_json
                )
                SELECT %s, summary, raw_json
                FROM public.step_7_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            cur.execute(
                """
                INSERT INTO public.step_8_results (
                    migration_id, summary, raw_json
                )
                SELECT %s, summary, raw_json
                FROM public.step_8_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            cur.execute(
                """
                INSERT INTO public.step_9_results (
                    migration_id, summary, raw_json
                )
                SELECT %s, summary, raw_json
                FROM public.step_9_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            cur.execute(
                """
                INSERT INTO public.step_10_results (
                    migration_id, summary, raw_json
                )
                SELECT %s, summary, raw_json
                FROM public.step_10_results WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            # 3d. Duplicate Mapping Rules
            cur.execute(
                """
                INSERT INTO public.mapping_rules (
                    migration_id, source_system, source_object, source_property, 
                    target_system, target_object, target_property, note, rule_type, enhancements
                )
                SELECT %s, source_system, source_object, source_property, 
                       target_system, target_object, target_property, note, rule_type, enhancements
                FROM public.mapping_rules WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            # 4. Duplicate pipelines, mappings, and agent states
            cur.execute(
                """
                SELECT id, name, description, source_data_source_id, target_data_source_id, 
                       source_system, target_system, execution_order, is_active, 
                       progress, objects_transferred, mapped_objects, workflow_type
                FROM public.pipelines WHERE migration_id = %s
                """,
                (id,),
            )
            pipelines = cur.fetchall()
            for p in pipelines:
                old_pipeline_id = p["id"]
                cur.execute(
                    """
                    INSERT INTO public.pipelines (
                        migration_id, name, description, source_data_source_id, target_data_source_id, 
                        source_system, target_system, execution_order, is_active, 
                        progress, objects_transferred, mapped_objects, workflow_type
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        new_migration_id,
                        p["name"],
                        p["description"],
                        p["source_data_source_id"],
                        p["target_data_source_id"],
                        p["source_system"],
                        p["target_system"],
                        p["execution_order"],
                        p["is_active"],
                        p["progress"],
                        p["objects_transferred"],
                        p["mapped_objects"],
                        p["workflow_type"],
                    ),
                )
                new_pipeline_row = cur.fetchone()
                new_pipeline_id = new_pipeline_row["id"]

                # Duplicate field mappings
                cur.execute(
                    """
                    INSERT INTO public.field_mappings (
                        pipeline_id, target_field_id, source_field_id, mapping_type, 
                        collection_item_field_id, join_with, description, 
                        source_object_type, target_object_type
                    )
                    SELECT %s, target_field_id, source_field_id, mapping_type, 
                           collection_item_field_id, join_with, description, 
                           source_object_type, target_object_type
                    FROM public.field_mappings WHERE pipeline_id = %s
                    """,
                    (new_pipeline_id, old_pipeline_id)
                )

                # Duplicate agent workflow state
                cur.execute(
                    """
                    INSERT INTO public.agent_workflow_states (
                        pipeline_id, briefing, plan, completed_steps, logs, is_running
                    )
                    SELECT %s, briefing, plan, completed_steps, logs, false
                    FROM public.agent_workflow_states WHERE pipeline_id = %s
                    """,
                    (new_pipeline_id, old_pipeline_id)
                )

            # 5. Duplicate migration_steps (History)
            cur.execute(
                """
                INSERT INTO public.migration_steps (
                    migration_id, workflow_step_id, name, status, status_message, result, created_at, updated_at
                )
                SELECT %s, workflow_step_id, name, status, status_message, result, created_at, updated_at
                FROM public.migration_steps WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            # 6. Duplicate migration_chat_messages (History)
            cur.execute(
                """
                INSERT INTO public.migration_chat_messages (
                    migration_id, role, content, step_number, created_at
                )
                SELECT %s, role, content, step_number, created_at
                FROM public.migration_chat_messages WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            # 6b. Duplicate mapping_chat_messages (Step 6/7 History)
            cur.execute(
                """
                INSERT INTO public.mapping_chat_messages (
                    migration_id, role, content, created_at
                )
                SELECT %s, role, content, created_at
                FROM public.mapping_chat_messages WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            # 7. Duplicate migration_activities (Timeline)
            cur.execute(
                """
                INSERT INTO public.migration_activities (
                    migration_id, type, title, timestamp, created_at
                )
                SELECT %s, type, title, timestamp, created_at
                FROM public.migration_activities WHERE migration_id = %s
                """,
                (new_migration_id, id)
            )

            # 8. Add duplication welcome messages to the chat
            welcome_msg_1 = f"Diese Migration wurde von **{original['name']}** dupliziert."
            
            cur.execute(
                """
                INSERT INTO public.migration_chat_messages (migration_id, role, content, step_number)
                VALUES (%s, 'system', %s, 0)
                """,
                (new_migration_id, welcome_msg_1)
            )

            # 9. Add activity for duplication
            cur.execute(
                """
                INSERT INTO public.migration_activities (migration_id, type, title, timestamp)
                VALUES (%s, 'info', 'Migration dupliziert', %s)
                """,
                (new_migration_id, datetime.now(timezone.utc).isoformat())
            )

            conn.commit()

            # 10. Duplicate Neo4j data (Async)
            await duplicate_neo4j_data(id, str(new_migration_id))

            return Migration(
                id=str(row["id"]),
                name=row["name"],
                source_system=row["source_system"],
                target_system=row["target_system"],
                source_url=row["source_url"],
                target_url=row["target_url"],
                in_connector=row["in_connector"],
                in_connector_detail=row["in_connector_detail"],
                out_connector=row["out_connector"],
                out_connector_detail=row["out_connector_detail"],
                objects_transferred=row["objects_transferred"],
                mapped_objects=row["mapped_objects"],
                project_id=str(row["project_id"]) if row["project_id"] else None,
                notes=row["notes"],
                scope_config=row["scope_config"],
                workflow_state=row["workflow_state"],
                progress=row["progress"],
                current_step=row["current_step"],
                step_status=row["step_status"],
                consultant_status=row["consultant_status"],
                status=row["status"],
                created_at=row["created_at"].isoformat(),
                updated_at=row["updated_at"].isoformat() if row["updated_at"] else None,
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error duplicating migration: {exc}")
        raise HTTPException(status_code=500, detail="Failed to duplicate migration.") from exc

@router.delete("/api/migrations/{id}")
async def delete_migration(id: str) -> dict[str, str]:
    """Delete a migration and its related records from the database."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            # Check if migration exists
            cur.execute("SELECT id FROM public.migrations WHERE id = %s", (id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Migration not found.")

            # Delete related migration activities
            cur.execute("DELETE FROM public.migration_activities WHERE migration_id = %s", (id,))
            # Delete related connectors
            cur.execute("DELETE FROM public.connectors WHERE migration_id = %s", (id,))
            # Delete the migration itself
            cur.execute("DELETE FROM public.migrations WHERE id = %s", (id,))
            
            # Delete Neo4j data
            await delete_neo4j_data(id)

            conn.commit()
            
            return {"message": f"Migration {id} and related records deleted successfully."}
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error deleting migration: {exc}")
        raise HTTPException(status_code=500, detail="Failed to delete migration.") from exc


from routers import data_sources
from routers import auth
from routers import projects
from routers import tools
from routers import neo4j_router
from routers import stats
from routers import settings
from routers import connectors

app.include_router(
    data_sources.router,
    prefix="/api/data_sources",
    tags=["data_sources"],
)
app.include_router(auth.router, tags=["auth"])
app.include_router(projects.router, prefix="/api", tags=["projects"])
app.include_router(tools.router, prefix="/api", tags=["tools"])
app.include_router(neo4j_router.router, prefix="/api/neo4j", tags=["neo4j"])
app.include_router(stats.router, prefix="/api/stats", tags=["stats"])
app.include_router(settings.router, prefix="/api", tags=["settings"])
app.include_router(connectors.router, prefix="/api/connectors", tags=["connectors"])




# ============================================================================
# Connector Endpoints
# ============================================================================







def _strip_eq_prefix(value: Optional[str]) -> Optional[str]:
    """Normalize PostgREST-style filter values by removing the `eq.` prefix."""

    if value and value.startswith("eq."):
        return value.replace("eq.", "", 1)
    return value





# ============================================================================
# Project Members Endpoints
# ============================================================================








@router.post("/api/v2/migrations/run-step")
async def enqueue_migration_step(payload: RunStepRequest) -> dict[str, Any]:
    """
    Production-ready counterpart to the dev-only Vite middleware.
    Creates/resets a migration_step and enqueues a job record for the worker.
    """

    if not payload.migrationId:
        raise HTTPException(status_code=400, detail="migrationId is required")
    if not payload.agentName:
        raise HTTPException(status_code=400, detail="agentName is required")
    if not payload.stepId and not payload.stepName:
        raise HTTPException(status_code=400, detail="stepId or stepName is required")

    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            # Ensure migration exists and mark as processing
            cur.execute("SELECT id FROM public.migrations WHERE id = %s", (payload.migrationId,))
            migration_row = cur.fetchone()
            if not migration_row:
                raise HTTPException(status_code=404, detail="Migration not found")

            cur.execute(
                "UPDATE public.migrations SET status = 'processing' WHERE id = %s RETURNING id",
                (payload.migrationId,),
            )
            cur.fetchone()

            # Try to find existing step by workflow_step_id or id::text
            step_row: Optional[dict[str, Any]] = None
            if payload.stepId:
                cur.execute(
                    """
                    SELECT id, workflow_step_id
                    FROM public.migration_steps
                    WHERE migration_id = %s AND (workflow_step_id = %s OR id::text = %s)
                    LIMIT 1
                    """,
                    (payload.migrationId, payload.stepId, payload.stepId),
                )
                step_row = cur.fetchone()

            if step_row:
                cur.execute(
                    """
                    UPDATE public.migration_steps
                    SET status = 'pending',
                        status_message = NULL,
                        result = NULL,
                        workflow_step_id = COALESCE(%s, workflow_step_id),
                        name = COALESCE(%s, name),
                        updated_at = now()
                    WHERE id = %s
                    RETURNING id, workflow_step_id
                    """,
                    (payload.stepId, payload.stepName, step_row["id"]),
                )
                step_row = cur.fetchone()
            else:
                workflow_step_id = payload.stepId or (payload.stepName or "").lower().replace(" ", "-") or "step"
                step_name = payload.stepName or payload.stepId or "Unnamed step"
                cur.execute(
                    """
                    INSERT INTO public.migration_steps (migration_id, workflow_step_id, name, status)
                    VALUES (%s, %s, %s, 'pending')
                    RETURNING id, workflow_step_id
                    """,
                    (payload.migrationId, workflow_step_id, step_name),
                )
                step_row = cur.fetchone()

            if not step_row:
                raise HTTPException(status_code=500, detail="Failed to create migration step")

            # Enqueue job
            cur.execute(
                """
                INSERT INTO public.jobs (step_id, payload, status)
                VALUES (%s, %s, 'pending')
                RETURNING id
                """,
                (step_row["id"], json.dumps(payload.model_dump())),
            )
            job_row = cur.fetchone()

            if job_row:
                publish_to_rabbitmq(job_row["id"])

            conn.commit()

            return {
                "jobId": job_row["id"] if job_row else None,
                "stepId": step_row["workflow_step_id"],
                "stepRowId": step_row["id"],
                "message": "Agent execution has been enqueued",
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/api/migrations/{id}/results")
async def get_migration_results(id: str) -> dict[str, Any]:
    """Fetch all structured results for steps 1 to 10."""
    try:
        results = {
            "step_1": [], "step_2": [], "step_3": [], "step_4": [], 
            "step_5": [], "step_6": [], "step_7": [], "step_8": [], 
            "step_9": [], "step_10": []
        }
        with get_db_connection() as conn, conn.cursor() as cur:
            # Step 1
            cur.execute("SELECT * FROM public.step_1_results WHERE migration_id = %s", (id,))
            results["step_1"] = [dict(row) for row in cur.fetchall()]
            
            # Step 2
            cur.execute("SELECT * FROM public.step_2_results WHERE migration_id = %s", (id,))
            results["step_2"] = [dict(row) for row in cur.fetchall()]
            
            # Step 3
            cur.execute("SELECT * FROM public.step_3_results WHERE migration_id = %s", (id,))
            results["step_3"] = [dict(row) for row in cur.fetchall()]

            # Step 4
            cur.execute("SELECT * FROM public.step_4_results WHERE migration_id = %s", (id,))
            results["step_4"] = [dict(row) for row in cur.fetchall()]

            # Step 5
            cur.execute("SELECT * FROM public.step_5_results WHERE migration_id = %s", (id,))
            results["step_5"] = [dict(row) for row in cur.fetchall()]

            # Step 6
            cur.execute("SELECT * FROM public.step_6_results WHERE migration_id = %s", (id,))
            results["step_6"] = [dict(row) for row in cur.fetchall()]

            # Step 7
            cur.execute("SELECT * FROM public.step_7_results WHERE migration_id = %s", (id,))
            results["step_7"] = [dict(row) for row in cur.fetchall()]

            # Step 8
            cur.execute("SELECT * FROM public.step_8_results WHERE migration_id = %s", (id,))
            results["step_8"] = [dict(row) for row in cur.fetchall()]

            # Step 9
            cur.execute("SELECT * FROM public.step_9_results WHERE migration_id = %s", (id,))
            results["step_9"] = [dict(row) for row in cur.fetchall()]

            # Step 10
            cur.execute("SELECT * FROM public.step_10_results WHERE migration_id = %s", (id,))
            results["step_10"] = [dict(row) for row in cur.fetchall()]
            
        return results
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@router.get("/api/schemes/objects/{system_name}")
async def get_system_object_specs(system_name: str) -> dict[str, Any]:
    """Fetch object specifications for a given system from the schemes/objects directory."""
    try:
        # Normalize system name to filename
        import re
        normalized = "".join(re.findall(r"[a-z0-9]", system_name.lower()))
        filename = f"{normalized}_objects.json"
        
        scheme_path = os.path.join(os.getcwd(), "schemes", "objects", filename)
        
        if not os.path.exists(scheme_path):
            raise HTTPException(status_code=404, detail=f"Object specs for system '{system_name}' not found at {scheme_path}")
            
        with open(scheme_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@router.get("/api/migrations/{id}/pipelines")
async def get_migration_pipelines(id: str) -> list[dict[str, Any]]:
    """Fetch all pipelines for a given migration."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, migration_id, name, description, source_system, target_system, execution_order, is_active FROM public.pipelines WHERE migration_id = %s ORDER BY execution_order ASC",
                (id,)
            )
            rows = cur.fetchall()
            return [dict(row) for row in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@router.get("/api/pipelines/{id}/mappings")
async def get_pipeline_mappings(id: str) -> list[dict[str, Any]]:
    """Fetch all field mappings for a given pipeline."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, pipeline_id, target_field_id, source_field_id, mapping_type, collection_item_field_id, join_with, description, source_object_type, target_object_type FROM public.field_mappings WHERE pipeline_id = %s",
                (id,)
            )
            rows = cur.fetchall()
            return [dict(row) for row in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/api/migrations/{id}/results")
async def update_migration_result(id: str, payload: UpdateResultPayload) -> dict[str, Any]:
    """Update or create a specific agent result record (UPSERT)."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            if payload.step == 1:
                cur.execute(
                    """
                    INSERT INTO public.step_1_results (migration_id, system_mode, raw_json, updated_at)
                    VALUES (%s, %s, %s, now())
                    ON CONFLICT (migration_id, system_mode) DO UPDATE SET
                        raw_json = EXCLUDED.raw_json,
                        updated_at = now()
                    """,
                    (id, payload.system_mode, json.dumps(payload.new_json))
                )
            elif payload.step == 2:
                cur.execute(
                    """
                    INSERT INTO public.step_2_results (migration_id, system_mode, raw_json, updated_at)
                    VALUES (%s, %s, %s, now())
                    ON CONFLICT (migration_id, system_mode) DO UPDATE SET
                        raw_json = EXCLUDED.raw_json,
                        updated_at = now()
                    """,
                    (id, payload.system_mode, json.dumps(payload.new_json))
                )
            elif payload.step == 3:
                cur.execute(
                    """
                    INSERT INTO public.step_3_results (migration_id, entity_name, raw_json, updated_at)
                    VALUES (%s, %s, %s, now())
                    ON CONFLICT (migration_id, entity_name) DO UPDATE SET
                        raw_json = EXCLUDED.raw_json,
                        updated_at = now()
                    """,
                    (id, payload.entity_name, json.dumps(payload.new_json))
                )
            elif payload.step in [4, 5, 6, 7, 8, 9, 10]:
                table_name = f"step_{payload.step}_results"
                cur.execute(
                    f"""
                    INSERT INTO public.{table_name} (migration_id, raw_json, updated_at)
                    VALUES (%s, %s, now())
                    ON CONFLICT (migration_id) DO UPDATE SET
                        raw_json = EXCLUDED.raw_json,
                        updated_at = now()
                    """,
                    (id, json.dumps(payload.new_json))
                )
            conn.commit()
        return {"message": "Result updated successfully"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@router.post("/api/migrations/{id}/inventory/{entity_name}/toggle-ignore")
async def toggle_entity_ignore(id: str, entity_name: str, display_name: Optional[str] = None) -> dict[str, Any]:
    """Toggle the ignore status of an entity in the inventory (Step 3 Results)."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            # First try by entity_name (technical key)
            cur.execute(
                "UPDATE public.step_3_results SET is_ignored = NOT is_ignored WHERE migration_id = %s AND entity_name = %s RETURNING is_ignored, entity_name",
                (id, entity_name),
            )
            row = cur.fetchone()
            
            # If not found and display_name is provided, try by display_name
            if not row and display_name:
                cur.execute(
                    "UPDATE public.step_3_results SET is_ignored = NOT is_ignored WHERE migration_id = %s AND entity_name = %s RETURNING is_ignored, entity_name",
                    (id, display_name),
                )
                row = cur.fetchone()

            if not row:
                # If still not found, insert it as a new entry (assuming it was implicit/not ignored before)
                cur.execute(
                    """
                    INSERT INTO public.step_3_results (migration_id, entity_name, is_ignored, count)
                    VALUES (%s, %s, true, 0)
                    RETURNING is_ignored, entity_name
                    """,
                    (id, entity_name)
                )
                row = cur.fetchone()
            
            conn.commit()
            return {"entity_name": row["entity_name"], "is_ignored": row["is_ignored"]}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
