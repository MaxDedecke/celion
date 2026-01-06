// src/agents/capabilityDiscovery/assistant.ts

import { btoa } from "buffer";
import type { SchemeDefinition } from "../../types/schemes";



export type CapabilityDiscoveryCredentials = {
  apiToken?: string;
  email?: string;
  password?: string;
};

export const normalizeSystemName = (systemName: string): string =>
  systemName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();

export const resolveSchemePath = (normalizedSystem: string) => `/schemes/${normalizedSystem}.json`;

const substituteCredentialToken = (
  token: string,
  credentials: CapabilityDiscoveryCredentials,
): string => {
  const normalized = token.toLowerCase();
  switch (normalized) {
    case "token":
    case "apitoken":
      return credentials.apiToken || "";
    case "email":
      return credentials.email || "";
    case "password":
      return credentials.password || "";
    default:
      return (credentials as Record<string, string | undefined>)[token] || "";
  }
};

const replaceBase64Placeholders = (
  value: string,
  credentials: CapabilityDiscoveryCredentials,
): string =>
  value.replace(/<BASE64\(([^)]+)\)>/gi, (_match, inner) => {
    const replacedInner = inner.replace(/([A-Za-z0-9_]+)/g, (token) => substituteCredentialToken(token, credentials));
    return btoa(replacedInner);
  });

const replaceCredentialPlaceholders = (
  value: string,
  credentials: CapabilityDiscoveryCredentials,
): string =>
  value.replace(/<([A-Za-z0-9_]+)>/g, (_match, token) => substituteCredentialToken(token, credentials));

export const buildAuthHeaders = (
  scheme: SchemeDefinition,
  credentials: CapabilityDiscoveryCredentials,
): Record<string, string> => {
  const template = scheme.auth?.headerTemplate;

  if (!template || typeof template !== "string") {
    return {};
  }

  const [rawKey, ...valueParts] = template.split(":");
  if (!rawKey || valueParts.length === 0) {
    return {};
  }

  const headerKey = rawKey.trim();
  const rawValue = valueParts.join(":").trim();
  const valueWithBase64 = replaceBase64Placeholders(rawValue, credentials);
  const headerValue = replaceCredentialPlaceholders(valueWithBase64, credentials);

  return { [headerKey]: headerValue };
};

export const mergeSchemeHeaders = (
  scheme: SchemeDefinition,
  authHeaders: Record<string, string>,
): Record<string, string> => ({
  ...(scheme.headers ?? {}),
  ...authHeaders,
});

export const resolveApiBaseUrl = (scheme: SchemeDefinition, userProvidedUrl: string): string => {
  if (scheme.apiBaseUrl) {
    return scheme.apiBaseUrl.replace(/\/$/, "");
  }

  const trimmed = userProvidedUrl?.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return trimmed.replace(/\/$/, "");
  }
};
