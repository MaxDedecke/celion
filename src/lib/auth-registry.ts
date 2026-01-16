export type AuthMethod = 'basic' | 'bearer' | 'header';

export interface SystemAuthConfig {
  id: string;
  name: string;
  authMethod: AuthMethod;
  headerName?: string; // Standard ist "Authorization"
  tokenPrefix?: string; // Präfix für den Token (z.B. "Bearer " oder ""). Wenn nicht gesetzt, entscheidet der Agent.
  whoamiEndpoint: string;
  displayNamePath?: string; // JSON-Pfad zum User-Namen in der Antwort (z.B. "displayName")
}

export const AUTH_REGISTRY: Record<string, SystemAuthConfig> = {
  "Jira Cloud": {
    id: "jiracloud",
    name: "Jira Cloud",
    authMethod: "basic",
    whoamiEndpoint: "/rest/api/3/myself",
    displayNamePath: "displayName"
  },
  "Jira Server": {
    id: "jiraserver",
    name: "Jira Server",
    authMethod: "basic",
    whoamiEndpoint: "/rest/api/2/myself",
    displayNamePath: "displayName"
  },
  "GitLab": {
    id: "gitlab",
    name: "GitLab",
    authMethod: "header",
    headerName: "PRIVATE-TOKEN",
    tokenPrefix: "",
    whoamiEndpoint: "/api/v4/user",
    displayNamePath: "name"
  },
  "Asana": {
    id: "asana",
    name: "Asana",
    authMethod: "bearer",
    tokenPrefix: "Bearer ",
    whoamiEndpoint: "/api/1.0/users/me",
    displayNamePath: "data.name"
  },
  "Azure DevOps": {
    id: "azuredevops",
    name: "Azure DevOps",
    authMethod: "basic",
    whoamiEndpoint: "/_apis/profile/profiles/me?api-version=6.0",
    displayNamePath: "displayName"
  },
  "ClickUp": {
    id: "clickup",
    name: "ClickUp",
    authMethod: "header",
    headerName: "Authorization",
    tokenPrefix: "", // WICHTIG: Kein "Bearer " für Personal Tokens
    whoamiEndpoint: "/api/v2/user",
    displayNamePath: "user.username"
  }
};

export const getSystemAuthConfig = (systemName: string): SystemAuthConfig | null => {
  // Exakter Match
  if (AUTH_REGISTRY[systemName]) return AUTH_REGISTRY[systemName];
  
  // Heuristik: "Jira" im Namen -> Jira Cloud Fallback
  if (systemName.toLowerCase().includes("jira")) return AUTH_REGISTRY["Jira Cloud"];
  if (systemName.toLowerCase().includes("gitlab")) return AUTH_REGISTRY["GitLab"];
  
  return null;
};
