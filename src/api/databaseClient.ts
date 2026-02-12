import { getClient } from "@/auth/keycloakClient";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/database/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

const USER_STORAGE_KEY = "celion_local_user";

type StoredUser = Omit<Tables<"users">, "password"> | null;

const getStorage = () => (typeof localStorage !== "undefined" ? localStorage : null);

const getStoredUser = (): StoredUser => {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Tables<"users">) : null;
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

async function fetchFromApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ data: T | null; error: Error | null; count?: number }> {
  try {
    const keycloak = getClient();
    const headers = new Headers(options.headers);

    if (keycloak?.token) {
      headers.set("Authorization", `Bearer ${keycloak.token}`);
    }

    const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

    if (!response.ok) {
      const detail = await parseErrorDetail(response);
      return { data: null, error: new Error(detail ?? `Request failed with status ${response.status}`) };
    }

    if (response.status === 204) {
      return { data: null, error: null };
    }

    const data = await response.json();
    const countHeader = response.headers.get('X-Total-Count');
    const count = countHeader ? parseInt(countHeader, 10) : undefined;
    
    return { data, error: null, count };
  } catch (error) {
    return { data: null, error: error as Error, count: 0 };
  }
}

export const databaseClient = {
  getSession: () => Promise.resolve(buildSessionResponse(getStoredUser())),
  signOut: () => {
    clearStoredUser();
    return Promise.resolve({ error: null });
  },
  setSessionUser: (user: StoredUser) => {
    persistUser(user);
    return Promise.resolve(buildSessionResponse(user));
  },
  createGuestSession: async () => {
    const guestUser: StoredUser = {
      id: `guest-${Date.now()}`,
      email: "guest@celion.local",
      full_name: "Guest",
      created_at: new Date().toISOString(),
    } as StoredUser;

    // Sync guest user to database
    await databaseClient.syncUser({
      id: guestUser.id,
      email: guestUser.email,
      full_name: guestUser.full_name,
    });

    persistUser(guestUser);
    return Promise.resolve(buildSessionResponse(guestUser));
  },
  syncUser: async (user: { id: string; email: string; full_name?: string }) => {
    try {
      const response = await fetch(`${API_BASE_URL}/users/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(user),
      });

      if (!response.ok) {
        const detail = await parseErrorDetail(response);
        console.error("User sync failed:", detail);
        return { data: null, error: new Error(detail ?? "User sync failed") };
      }

      return { data: await response.json(), error: null };
    } catch (error) {
      console.error("User sync error:", error);
      return { data: null, error: error as Error };
    }
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

  fetchProjects: () => {
    const user = getStoredUser();
    return fetchFromApi<Tables<"projects">[]>(`/projects${user?.id ? `?user_id=${user.id}` : ''}`);
  },

  fetchProjectNames: () => {
    const user = getStoredUser();
    return fetchFromApi<{id: string, name: string}[]>(`/projects?select=id,name${user?.id ? `&user_id=${user.id}` : ''}`);
  },

  fetchProjectByName: async (name: string) => {
    const response = await fetchFromApi<Tables<"projects">[]>(`/projects?name=${name}`);
    if (response.error) return { ...response, data: null };
    const projects = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
    return { ...response, data: projects[0] ?? null };
  },

  fetchProjectById: (id: string) => fetchFromApi<Tables<"projects">>(`/projects/${id}`),

  countMigrationsByProject: (projectId: string) => fetchFromApi<number>(`/migrations?project_id=eq.${projectId}&select=count`),

  fetchMigrationsByProject: (projectId: string) => fetchFromApi<Tables<"migrations">[]>(`/migrations?project_id=eq.${projectId}`),

  fetchStandaloneMigrations: () => {
    const user = getStoredUser();
    return fetchFromApi<Tables<"migrations">[]>(`/migrations?project_id=is.null${user?.id ? `&user_id=${user.id}` : ''}`);
  },

  fetchStandaloneMigrationsPaginated: (limit: number, offset: number) => {
    const user = getStoredUser();
    return fetchFromApi<Tables<"migrations">[]>(`/migrations?project_id=is.null&limit=${limit}&offset=${offset}${user?.id ? `&user_id=${user.id}` : ''}`);
  },

  fetchMigrationById: (migrationId: string) => fetchFromApi<Tables<"migrations">>(`/migrations/${migrationId}`),

  fetchMigrationActivities: (migrationId: string) => fetchFromApi<Tables<"migration_activities">[]>(`/migration_activities?migration_id=eq.${migrationId}`),

  fetchMigrationSteps: (migrationId: string) => fetchFromApi<any[]>(`/migration_steps?migration_id=${migrationId}`),

  fetchConnectorsByMigration: (migrationId: string) => fetchFromApi<Tables<"connectors">[]>(`/connectors?migration_id=eq.${migrationId}`),

  fetchConnectorByType: async (migrationId: string, connectorType: "in" | "out") => {
    const response = await fetchFromApi<Tables<"connectors">[]>(`/connectors?migration_id=eq.${migrationId}&connector_type=eq.${connectorType}`);

    if (response.error) return { ...response, data: null };

    const connectors = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
    return { ...response, data: connectors[0] ?? null };
  },

  insertProject: (payload: TablesInsert<"projects">) => fetchFromApi<Tables<"projects">>("/projects", { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } }),

  updateProject: (id: string, payload: TablesUpdate<"projects">) => fetchFromApi<Tables<"projects">>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } }),

  deleteProject: (id: string) => fetchFromApi<void>(`/projects/${id}`, { method: "DELETE" }),

  insertMigration: (payload: TablesInsert<"migrations">) => fetchFromApi<Tables<"migrations">>("/migrations", { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } }),

  updateMigration: (id: string, payload: TablesUpdate<"migrations">) => fetchFromApi<Tables<"migrations">>(`/migrations/${id}`, { method: "PATCH", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } }),

  duplicateMigration: (id: string) => {
    const user = getStoredUser();
    return fetchFromApi<Tables<"migrations">>(`/migrations/${id}/duplicate?user_id=${user?.id}`, { method: "POST" });
  },

  deleteMigration: (id: string) => fetchFromApi<void>(`/migrations/${id}`, { method: "DELETE" }),

  insertMigrationActivities: (payloads: TablesInsert<"migration_activities">[]) => fetchFromApi<Tables<"migration_activities">>("/migration_activities", { method: "POST", body: JSON.stringify(payloads), headers: { "Content-Type": "application/json" } }),

  insertConnectors: (payload: TablesInsert<"connectors">[]) => fetchFromApi<Tables<"connectors">>("/connectors", { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } }),

  updateConnector: (id: string, payload: TablesUpdate<"connectors">) => fetchFromApi<Tables<"connectors">>(`/connectors?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } }),

  updateConnectorByType: async (
    migrationId: string,
    connectorType: "in" | "out",
    payload: TablesUpdate<"connectors">,
  ) => {
    // Try to update first (PATCH)
    const updateResponse = await fetchFromApi<Tables<"connectors">>(`/connectors?migration_id=eq.${migrationId}&connector_type=eq.${connectorType}`, { 
      method: "PATCH", 
      body: JSON.stringify(payload), 
      headers: { "Content-Type": "application/json" } 
    });

    // If successful, or if error is NOT a 404/Not Found, return the result
    if (!updateResponse.error) {
      return updateResponse;
    }
    
    const errorMsg = updateResponse.error.message;
    // Check for various 404 indicators
    const isNotFound = errorMsg.includes("404") || errorMsg.includes("not found") || errorMsg.includes("Not Found");

    if (!isNotFound) {
      return updateResponse;
    }

    // If 404, it means the connector doesn't exist, so we create it (POST)
    const createPayload = {
      migration_id: migrationId,
      connector_type: connectorType,
      ...payload
    };

    // The backend POST endpoint expects an array of connectors and returns an array
    const createResponse = await fetchFromApi<Tables<"connectors">[]>("/connectors", {
      method: "POST",
      body: JSON.stringify([createPayload]),
      headers: { "Content-Type": "application/json" }
    });
    
    // Unwrap the list to return a single connector object to match the expected return type
    if (createResponse.data && createResponse.data.length > 0) {
      return { ...createResponse, data: createResponse.data[0] };
    }
    
    // If creation returned empty list or error, return that (casted)
    return { ...createResponse, data: null };
  },

  insertMigrationActivity: (payload: TablesInsert<"migration_activities">) => fetchFromApi<Tables<"migration_activities">>("/migration_activities", { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } }),

  fetchDataSources: () => fetchFromApi<Tables<"data_sources">[]>("/data_sources"),

  fetchDataSourceAssignments: (dataSourceId: string) => fetchFromApi<{project_id: string}[]>(`/data_source_projects?data_source_id=eq.${dataSourceId}&select=project_id`),

  insertDataSource: (payload: TablesInsert<"data_sources">) => fetchFromApi<Tables<"data_sources">>("/data_sources", { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } }),

  updateDataSource: (id: string, payload: TablesUpdate<"data_sources">) => fetchFromApi<Tables<"data_sources">>(`/data_sources?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } }),

  deleteDataSource: (id: string) => fetchFromApi<void>(`/data_sources?id=eq.${id}`, { method: "DELETE" }),

  upsertDataSourceProjectAssignment: (
    dataSourceId: string,
    projectId: string,
    payload: TablesInsert<"data_source_projects">,
  ) => fetchFromApi<Tables<"data_source_projects">>(`/data_source_projects?data_source_id=eq.${dataSourceId}&project_id=eq.${projectId}`, { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" } }),

  deleteDataSourceProjectAssignments: (dataSourceId: string) => fetchFromApi<void>(`/data_source_projects?data_source_id=eq.${dataSourceId}`, { method: "DELETE" }),

  insertDataSourceProjectAssignments: (
    assignments: TablesInsert<"data_source_projects">[],
  ) => fetchFromApi<Tables<"data_source_projects">>("/data_source_projects", { method: "POST", body: JSON.stringify(assignments), headers: { "Content-Type": "application/json" } }),

  fetchFieldMappings: (pipelineId: string, sourceObjectType: string, targetObjectType: string) => fetchFromApi<Tables<"field_mappings">[]>(`/field_mappings?pipeline_id=eq.${pipelineId}&source_object_type=eq.${sourceObjectType}&target_object_type=eq.${targetObjectType}`),

  fetchAllMappingsForSource: (pipelineId: string, sourceObjectType: string) => fetchFromApi<Tables<"field_mappings">[]>(`/field_mappings?pipeline_id=eq.${pipelineId}&source_object_type=eq.${sourceObjectType}`),

  fetchMigrationResults: (migrationId: string) => fetchFromApi<any>(`/migrations/${migrationId}/results`),

  fetchObjectSpecs: (systemName: string) => fetchFromApi<any>(`/schemes/objects/${systemName}`),

  toggleEntityIgnore: (migrationId: string, entityName: string, displayName?: string) => 
    fetchFromApi<any>(`/migrations/${migrationId}/inventory/${entityName}/toggle-ignore${displayName ? `?display_name=${encodeURIComponent(displayName)}` : ''}`, {
      method: "POST",
    }),

  updateMigrationResult: (migrationId: string, step: number, newJson: any, systemMode?: string, entityName?: string) => 
    fetchFromApi<any>(`/migrations/${migrationId}/results`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step, new_json: newJson, system_mode: systemMode, entity_name: entityName })
    }),

  fetchMigrationPipelines: (migrationId: string) => fetchFromApi<any[]>(`/migrations/${migrationId}/pipelines`),

  fetchPipelineMappings: (pipelineId: string) => fetchFromApi<any[]>(`/pipelines/${pipelineId}/mappings`),

  upsertFieldMapping: (payload: TablesInsert<"field_mappings"> | TablesUpdate<"field_mappings">) => {
    const payloadArray = Array.isArray(payload) ? payload : [payload];
    return fetchFromApi<Tables<"field_mappings">>("/field_mappings", { method: "POST", body: JSON.stringify(payloadArray), headers: { "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates" } });
  },

  deleteFieldMapping: (mappingId: string) => fetchFromApi<void>(`/field_mappings?id=eq.${mappingId}`, { method: "DELETE" }),

  clearFieldMappingsForPipeline: (pipelineId: string) => fetchFromApi<void>(`/field_mappings?pipeline_id=eq.${pipelineId}`, { method: "DELETE" }),

  // Project members
  fetchProjectMembers: (projectId: string) => fetchFromApi<Tables<"project_members">[]>(`/project_members?project_id=eq.${projectId}`),

  addProjectMember: (projectId: string, userId: string, role: string = 'member') =>
    fetchFromApi<Tables<"project_members">>("/project_members", {
      method: "POST",
      body: JSON.stringify({ project_id: projectId, user_id: userId, role }),
      headers: { "Content-Type": "application/json" }
    }),

  removeProjectMember: (projectId: string, userId: string) =>
    fetchFromApi<void>(`/project_members?project_id=eq.${projectId}&user_id=eq.${userId}`, { method: "DELETE" }),
};
