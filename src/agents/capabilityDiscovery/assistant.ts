// src/agents/capabilityDiscovery/assistant.ts

import { btoa } from "buffer";
import type { OpenAiTool } from "../openai/types";
import type { SchemeDefinition } from "../../types/schemes";

export const getCapabilityDiscoveryConfig = (): { instructions: string; tools: OpenAiTool[] } => {
  const instructions = `You are an expert at discovering the capabilities of a system based on its API.
Your task is to determine how many objects of different types exist in the system.
You must call the 'discover_capabilities_from_scheme' tool to perform the actual discovery.
Do not try to do it yourself.
After the tool returns the data, format the output as a JSON object and return it.`;

  const tools: OpenAiTool[] = [
    {
      type: "function",
      function: {
        name: "discover_capabilities_from_scheme",
        description: "Discovers resources and their counts for a given system by reading a scheme and calling the system's API endpoints.",
        parameters: {
          type: "object",
          properties: {
            baseUrl: {
              type: "string",
              description: "The base URL of the API.",
            },
            system: {
              type: "string",
              description: "The name of the system.",
            },
            apiToken: {
              type: "string",
              description: "The API token for authentication.",
            },
            email: {
              type: "string",
              description: "The email for authentication, if applicable.",
            },
            password: {
              type: "string",
              description: "The password for authentication, if applicable.",
            },
          },
          required: ["baseUrl", "system", "apiToken"],
        },
      },
    },
  ];

  return { instructions, tools };
};



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
