import { supabase } from "@/integrations/database/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/database/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

const USER_STORAGE_KEY = "celion_local_user";

type StoredUser = Omit<Tables<"users">["Row"], "password"> | null;

const getStorage = () => (typeof localStorage !== "undefined" ? localStorage : null);

const getStoredUser = (): StoredUser => {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Tables<"users">["Row"]) : null;
  } catch (error) {
    console.error("Failed to read stored user", error);
    return null;
  }
};

const persistUser = (user: StoredUser) => {
  const storage = getStorage();
  storage?.setItem(USER_STORAGE_KEY, JSON.stringify(user));
};

const clearStoredUser = () => {
  const storage = getStorage();
  storage?.removeItem(USER_STORAGE_KEY);
};

const buildSessionResponse = (user: StoredUser) => ({
  data: { session: user ? { user } : null },
  error: null,
});

const buildUserResponse = (user: StoredUser) => ({
  data: { user: user ?? null },
  error: null,
});

const parseErrorDetail = async (response: Response) => {
  try {
    const body = await response.json();
    if (body && typeof body === "object" && "detail" in body) {
      return (body as { detail?: string }).detail ?? null;
    }
    return typeof body === "string" ? body : JSON.stringify(body);
  } catch {
    try {
      return await response.text();
    } catch {
      return null;
    }
  }
};

export const databaseClient = {
  getSession: () => Promise.resolve(buildSessionResponse(getStoredUser())),
  signOut: () => {
    clearStoredUser();
    return Promise.resolve({ error: null });
  },
  signUp: async (email: string, password: string) => {
    const response = await fetch(`${API_BASE_URL}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const detail = await parseErrorDetail(response);
      return { data: null, error: new Error(detail ?? "Registrierung fehlgeschlagen") };
    }

    const data = (await response.json()) as StoredUser;
    persistUser(data);
    return { data, error: null };
  },
  signInWithPassword: async (email: string, password: string) => {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const detail = await parseErrorDetail(response);
      return { data: null, error: new Error(detail ?? "Ungültige Zugangsdaten") };
    }

    const data = (await response.json()) as StoredUser;
    persistUser(data);
    return { data, error: null };
  },
  getUser: () => Promise.resolve(buildUserResponse(getStoredUser())),

  fetchProjects: () =>
    supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false }),

  fetchProjectNames: () =>
    supabase
      .from("projects")
      .select("id, name")
      .order("name", { ascending: true }),

  fetchProjectByName: (name: string) =>
    supabase
      .from("projects")
      .select("*")
      .eq("name", name)
      .maybeSingle(),

  countMigrationsByProject: (projectId: string) =>
    supabase
      .from("migrations")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId),

  fetchMigrationsByProject: (projectId: string) =>
    supabase
      .from("migrations")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),

  fetchStandaloneMigrations: () =>
    supabase
      .from("migrations")
      .select("*")
      .is("project_id", null)
      .order("created_at", { ascending: false }),

  fetchStandaloneMigrationsPaginated: (limit: number, offset: number) =>
    supabase
      .from("migrations")
      .select("*", { count: "exact" })
      .is("project_id", null)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),

  fetchMigrationById: (migrationId: string) =>
    supabase
      .from("migrations")
      .select("*")
      .eq("id", migrationId)
      .single(),

  fetchMigrationActivities: (migrationId: string) =>
    supabase
      .from("migration_activities")
      .select("*")
      .eq("migration_id", migrationId)
      .order("created_at", { ascending: false }),

  fetchConnectorsByMigration: (migrationId: string) =>
    supabase
      .from("connectors")
      .select("*")
      .eq("migration_id", migrationId),

  fetchConnectorByType: (migrationId: string, connectorType: "in" | "out") =>
    supabase
      .from("connectors")
      .select("*")
      .eq("migration_id", migrationId)
      .eq("connector_type", connectorType)
      .maybeSingle(),

  insertProject: (payload: TablesInsert<"projects">) =>
    supabase.from("projects").insert(payload),

  updateProject: (id: string, payload: TablesUpdate<"projects">) =>
    supabase
      .from("projects")
      .update(payload)
      .eq("id", id),

  deleteProject: (id: string) =>
    supabase
      .from("projects")
      .delete()
      .eq("id", id),

  insertMigration: (payload: TablesInsert<"migrations">) =>
    supabase
      .from("migrations")
      .insert(payload)
      .select()
      .single(),

  updateMigration: (id: string, payload: TablesUpdate<"migrations">) =>
    supabase
      .from("migrations")
      .update(payload)
      .eq("id", id),

  deleteMigration: (id: string) =>
    supabase
      .from("migrations")
      .delete()
      .eq("id", id),

  insertMigrationActivities: (payloads: TablesInsert<"migration_activities">[]) =>
    supabase.from("migration_activities").insert(payloads),

  insertConnectors: (payload: TablesInsert<"connectors">[]) =>
    supabase.from("connectors").insert(payload),

  updateConnector: (id: string, payload: TablesUpdate<"connectors">) =>
    supabase
      .from("connectors")
      .update(payload)
      .eq("id", id),

  updateConnectorByType: (
    migrationId: string,
    connectorType: "in" | "out",
    payload: TablesUpdate<"connectors">,
  ) =>
    supabase
      .from("connectors")
      .update(payload)
      .eq("migration_id", migrationId)
      .eq("connector_type", connectorType),

  insertMigrationActivity: (payload: TablesInsert<"migration_activities">) =>
    supabase.from("migration_activities").insert(payload),

  fetchDataSources: () =>
    supabase
      .from("data_sources")
      .select("*")
      .order("created_at", { ascending: false }),

  fetchDataSourceAssignments: (dataSourceId: string) =>
    supabase
      .from("data_source_projects")
      .select("project_id")
      .eq("data_source_id", dataSourceId),

  insertDataSource: (payload: TablesInsert<"data_sources">) =>
    supabase.from("data_sources").insert(payload).select().single(),

  updateDataSource: (id: string, payload: TablesUpdate<"data_sources">) =>
    supabase
      .from("data_sources")
      .update(payload)
      .eq("id", id),

  deleteDataSource: (id: string) =>
    supabase
      .from("data_sources")
      .delete()
      .eq("id", id),

  upsertDataSourceProjectAssignment: (
    dataSourceId: string,
    projectId: string,
    payload: TablesInsert<"data_source_projects">,
  ) =>
    supabase
      .from("data_source_projects")
      .upsert(payload)
      .eq("data_source_id", dataSourceId)
      .eq("project_id", projectId),

  deleteDataSourceProjectAssignments: (dataSourceId: string) =>
    supabase
      .from("data_source_projects")
      .delete()
      .eq("data_source_id", dataSourceId),

  insertDataSourceProjectAssignments: (
    assignments: TablesInsert<"data_source_projects">[],
  ) => supabase.from("data_source_projects").insert(assignments),

  fetchFieldMappings: (pipelineId: string, sourceObjectType: string, targetObjectType: string) =>
    supabase
      .from("field_mappings")
      .select("*")
      .eq("pipeline_id", pipelineId)
      .eq("source_object_type", sourceObjectType)
      .eq("target_object_type", targetObjectType),

  fetchAllMappingsForSource: (pipelineId: string, sourceObjectType: string) =>
    supabase
      .from("field_mappings")
      .select("*")
      .eq("pipeline_id", pipelineId)
      .eq("source_object_type", sourceObjectType),

  upsertFieldMapping: (payload: TablesInsert<"field_mappings"> | TablesUpdate<"field_mappings">) => {
    const payloadArray = Array.isArray(payload) ? payload : [payload];
    return supabase.from("field_mappings").upsert(payloadArray);
  },

  deleteFieldMapping: (mappingId: string) =>
    supabase
      .from("field_mappings")
      .delete()
      .eq("id", mappingId),

  clearFieldMappingsForPipeline: (pipelineId: string) =>
    supabase
      .from("field_mappings")
      .delete()
      .eq("pipeline_id", pipelineId),
};
