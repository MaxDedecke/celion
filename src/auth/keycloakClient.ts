import Keycloak, { type KeycloakConfig, type KeycloakProfile, type KeycloakTokenParsed } from "keycloak-js";

const keycloakConfig: KeycloakConfig | null = (() => {
  const url = import.meta.env.VITE_KEYCLOAK_URL;
  const realm = import.meta.env.VITE_KEYCLOAK_REALM;
  const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID;

  if (!url || !realm || !clientId) {
    return null;
  }

  return {
    url,
    realm,
    clientId,
  };
})();

let keycloak: Keycloak | null = null;
let initialized = false;

export const getClient = () => {
  if (!keycloakConfig) return null;
  if (!keycloak) {
    keycloak = new Keycloak(keycloakConfig);
  }
  return keycloak;
};

export const hasKeycloakConfig = () => Boolean(keycloakConfig);

export const initKeycloak = async (onLoad?: "check-sso" | "login-required") => {
  const client = getClient();
  if (!client) return { client: null, authenticated: false };

  const authenticated = await client.init({
    onLoad,
    pkceMethod: "S256",
    checkLoginIframe: false,
  });

  return { client, authenticated };
};

export const login = async () => {
  const client = getClient();
  if (!client) {
    throw new Error("Keycloak ist nicht konfiguriert (VITE_KEYCLOAK_URL/REALM/CLIENT_ID).");
  }
  await client.login();
};

export const logout = async () => {
  const client = getClient();
  if (!client || !client.authenticated) return;

  try {
    await client.logout({ redirectUri: window.location.origin });
  } catch (error) {
    console.error("Keycloak logout failed", error);
  }
};

export const buildUserFromKeycloak = (
  profile: KeycloakProfile,
  token: KeycloakTokenParsed | undefined,
) => {
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  const preferred = (token?.preferred_username as string | undefined) ?? "";
  return {
    id: profile.id || (token?.sub as string | undefined) || `kc-${Date.now()}`,
    email: profile.email || (token?.email as string | undefined) || `${preferred || "user"}@keycloak.local`,
    full_name: fullName || preferred || "Keycloak User",
    created_at: new Date().toISOString(),
  };
};
