from fastapi import APIRouter, HTTPException
from typing import Any, Optional
from datetime import datetime, date

from models.projects import Project, CreateProjectPayload, UpdateProjectPayload, ProjectMember, CreateProjectMemberPayload, DataSourceProject
from core.database import get_db_connection
from core.neo4j_utils import delete_neo4j_data

router = APIRouter()

def _strip_eq_prefix(value: Optional[str]) -> Optional[str]:
    """Helper to remove 'eq.' prefix from Supabase-style query params."""
    if value and value.startswith("eq."):
        return value[3:]
    return value


@router.get("/projects", response_model=list[Project])
async def get_projects(
    user_id: Optional[str] = None,
    name: Optional[str] = None,
    select: Optional[str] = None
) -> Any:
    """Fetch projects, optionally filtered by user_id or name."""
    user_id = _strip_eq_prefix(user_id)
    
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            if select == "id,name":
                query = "SELECT id, name FROM public.projects"
                params = []
                if user_id:
                    query = """
                        SELECT p.id, p.name 
                        FROM public.projects p
                        LEFT JOIN public.project_members pm ON p.id = pm.project_id
                        WHERE p.user_id = %s OR pm.user_id = %s
                        ORDER BY p.created_at DESC
                    """
                    params = [user_id, user_id]
                else:
                    query += " ORDER BY created_at DESC"
                    
                cur.execute(query, tuple(params))
                return [{"id": str(r["id"]), "name": r["name"]} for r in cur.fetchall()]

            if name:
                cur.execute(
                    "SELECT id, name, description, created_at FROM public.projects WHERE name = %s",
                    (name,),
                )
            elif user_id:
                # Include projects where the user is the creator OR a member
                cur.execute(
                    """
                    SELECT p.id, p.name, p.description, p.created_at 
                    FROM public.projects p
                    LEFT JOIN public.project_members pm ON p.id = pm.project_id
                    WHERE p.user_id = %s OR pm.user_id = %s
                    ORDER BY p.created_at DESC
                    """,
                    (user_id, user_id),
                )
            else:
                cur.execute(
                    "SELECT id, name, description, created_at FROM public.projects ORDER BY created_at DESC"
                )
            project_rows = cur.fetchall()
            projects = []
            for row in project_rows:
                try:
                    created_at_str = ""
                    if isinstance(row["created_at"], (datetime, date)):
                        created_at_str = row["created_at"].isoformat()
                    else:
                        created_at_str = str(row["created_at"]) if row["created_at"] else ""
                        
                    projects.append(Project(
                        id=str(row["id"]),
                        name=row["name"],
                        description=row["description"],
                        created_at=created_at_str,
                    ))
                except Exception as row_err:
                    print(f"Error serializing project row {row.get('id')}: {row_err}")
                    continue
            return projects
    except Exception as exc:
        print(f"Error fetching projects: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch projects.") from exc


@router.get("/projects/{id}", response_model=Project)
async def get_project(id: str) -> Project:
    """Fetch a single project from the database."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, description, created_at FROM public.projects WHERE id = %s",
                (id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Project not found.")

            return Project(
                id=str(row["id"]),
                name=row["name"],
                description=row["description"],
                created_at=row["created_at"].isoformat(),
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error fetching project: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch project.") from exc


@router.post("/projects", response_model=Project)
async def create_project(payload: CreateProjectPayload) -> Project:
    """Create a new project and automatically add the creator as owner."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            # Create the project
            cur.execute(
                """
                INSERT INTO public.projects (name, description, user_id)
                VALUES (%s, %s, %s)
                RETURNING id, name, description, created_at
                """,
                (payload.name, payload.description, payload.user_id),
            )
            row = cur.fetchone()

            if not row:
                raise HTTPException(status_code=500, detail="Failed to create project.")

            project_id = str(row["id"])

            # Automatically add creator as owner in project_members
            cur.execute(
                """
                INSERT INTO public.project_members (project_id, user_id, role)
                VALUES (%s, %s, 'owner')
                ON CONFLICT (project_id, user_id) DO NOTHING
                """,
                (project_id, payload.user_id),
            )

            conn.commit()

            return Project(
                id=project_id,
                name=row["name"],
                description=row["description"],
                created_at=row["created_at"].isoformat(),
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error creating project: {exc}")
        raise HTTPException(status_code=500, detail="Failed to create project.") from exc


@router.patch("/projects/{id}", response_model=Project)
async def update_project(id: str, payload: UpdateProjectPayload) -> Project:
    """Update a project by id."""
    if not id:
        raise HTTPException(status_code=400, detail="Project id is required.")

    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            updates: list[str] = []
            params: list[Any] = []
            
            payload_dict = payload.model_dump(exclude_none=True)
            for field, value in payload_dict.items():
                updates.append(f"{field} = %s")
                params.append(value)
            
            if not updates:
                raise HTTPException(status_code=400, detail="No fields to update.")
            
            updates.append("updated_at = now()")
            params.append(id)
            
            query = f"""
                UPDATE public.projects
                SET {", ".join(updates)}
                WHERE id = %s
                RETURNING id, name, description, created_at
            """
            
            cur.execute(query, tuple(params))
            row = cur.fetchone()
            conn.commit()
            
            if not row:
                raise HTTPException(status_code=404, detail="Project not found.")
            
            return Project(
                id=str(row["id"]),
                name=row["name"],
                description=row["description"],
                created_at=row["created_at"].isoformat(),
            )
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error updating project: {exc}")
        raise HTTPException(status_code=500, detail="Failed to update project.") from exc


@router.delete("/projects/{id}")
async def delete_project(id: str) -> dict[str, str]:
    """Delete a project and all related records, including Neo4j data for migrations."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT id FROM public.projects WHERE id = %s", (id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Project not found.")

            # Get all migration IDs associated with this project to clean up Neo4j
            cur.execute("SELECT id FROM public.migrations WHERE project_id = %s", (id,))
            migration_ids = [str(row["id"]) for row in cur.fetchall()]

            # Delete Neo4j data for each migration
            for mig_id in migration_ids:
                try:
                    await delete_neo4j_data(mig_id)
                except Exception as neo_err:
                    print(f"Warning: Failed to delete Neo4j data for migration {mig_id}: {neo_err}")

            # Delete project (cascades to project_members, migrations, and other related PG tables)
            cur.execute("DELETE FROM public.projects WHERE id = %s", (id,))
            conn.commit()
            
            return {"message": f"Project {id} and its {len(migration_ids)} migrations deleted successfully."}
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error deleting project: {exc}")
        raise HTTPException(status_code=500, detail="Failed to delete project.") from exc


@router.get("/project_members", response_model=list[ProjectMember])
async def get_project_members(
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> list[ProjectMember]:
    """Fetch project members, optionally filtered by project_id or user_id."""
    project_id = _strip_eq_prefix(project_id)
    user_id = _strip_eq_prefix(user_id)

    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            query = "SELECT id, project_id, user_id, role, created_at FROM public.project_members"
            params = []
            conditions = []
            
            if project_id:
                conditions.append("project_id = %s")
                params.append(project_id)
            if user_id:
                conditions.append("user_id = %s")
                params.append(user_id)
                
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
                
            cur.execute(query, tuple(params))
            rows = cur.fetchall()

            return [
                ProjectMember(
                    id=str(row["id"]),
                    project_id=str(row["project_id"]),
                    user_id=str(row["user_id"]),
                    role=row["role"],
                    created_at=row["created_at"].isoformat(),
                )
                for row in rows
            ]
    except Exception as exc:
        print(f"Error fetching project members: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch project members.") from exc

@router.post("/project_members", response_model=ProjectMember)
async def create_project_member(payload: CreateProjectMemberPayload) -> ProjectMember:
    """Add a member to a project."""
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            # Check if project exists
            cur.execute("SELECT id FROM public.projects WHERE id = %s", (payload.project_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Project not found.")
                
            # Insert member (upsert on conflict to handle role updates if needed later, though currently it's just basic insert)
            cur.execute(
                """
                INSERT INTO public.project_members (project_id, user_id, role)
                VALUES (%s, %s, %s)
                RETURNING id, project_id, user_id, role, created_at
                """,
                (payload.project_id, payload.user_id, payload.role),
            )
            row = cur.fetchone()
            conn.commit()

            if not row:
                raise HTTPException(status_code=500, detail="Failed to add project member.")

            return ProjectMember(
                id=str(row["id"]),
                project_id=str(row["project_id"]),
                user_id=str(row["user_id"]),
                role=row["role"],
                created_at=row["created_at"].isoformat(),
            )
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=400, detail="User is already a member of this project.")
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error creating project member: {exc}")
        raise HTTPException(status_code=500, detail="Failed to add project member.") from exc

@router.delete("/project_members")
async def delete_project_member(
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
):
    """Remove a member from a project."""
    project_id = _strip_eq_prefix(project_id)
    user_id = _strip_eq_prefix(user_id)
    
    if not project_id or not user_id:
        raise HTTPException(status_code=400, detail="project_id and user_id are required.")

    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            # Verify they aren't the last owner
            cur.execute("SELECT role FROM public.project_members WHERE project_id = %s AND user_id = %s", (project_id, user_id))
            member = cur.fetchone()
            if not member:
                raise HTTPException(status_code=404, detail="Project member not found.")
                
            if member["role"] == "owner":
                cur.execute("SELECT COUNT(*) as count FROM public.project_members WHERE project_id = %s AND role = 'owner'", (project_id,))
                count = cur.fetchone()["count"]
                if count <= 1:
                    raise HTTPException(status_code=400, detail="Cannot remove the last owner of a project.")

            cur.execute(
                "DELETE FROM public.project_members WHERE project_id = %s AND user_id = %s RETURNING id",
                (project_id, user_id),
            )
            deleted = cur.fetchone()
            conn.commit()

            if not deleted:
                raise HTTPException(status_code=404, detail="Project member not found.")

            return {"status": "success", "message": "Project member removed"}
    except HTTPException:
        raise
    except Exception as exc:
        print(f"Error deleting project member: {exc}")
        raise HTTPException(status_code=500, detail="Failed to delete project member.") from exc

@router.get("/data_source_projects", response_model=list[DataSourceProject])
async def get_data_source_projects(data_source_id: Optional[str] = None) -> list[DataSourceProject]:
    """Fetch data source to project assignments."""
    data_source_id = _strip_eq_prefix(data_source_id)
    
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            query = "SELECT project_id FROM public.data_source_projects"
            params = []

            if data_source_id:
                query += " WHERE data_source_id = %s"
                params.append(data_source_id)

            cur.execute(query, tuple(params))
            rows = cur.fetchall()
            return [{"project_id": str(row['project_id'])} for row in rows]
    except Exception as exc:
        print(f"Error fetching data source projects: {exc}")
        raise HTTPException(status_code=500, detail="Failed to fetch data source projects.") from exc
