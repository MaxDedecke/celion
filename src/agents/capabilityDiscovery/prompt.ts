// src/agents/capabilityDiscovery/prompt.ts

export const hasPathPlaceholders = (endpoint: string): boolean => /\{[^}]+\}/.test(endpoint);

export const buildUrlWithQuery = (
  baseUrl: string,
  endpoint: string,
  queryParams?: Record<string, string | number | undefined>,
): string => {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = new URL(normalizedEndpoint, normalizedBase);

  const params = new URLSearchParams(url.search);
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      if (value === undefined || value === null) continue;
      params.set(key, String(value));
    }
  }

  const queryString = params.toString();
  url.search = queryString;

  return url.toString();
};
