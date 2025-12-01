import type { HttpRequestParams, HttpResponse } from "@/types/agents";
import { resolveApiUrl } from "../lib/server-helpers";

const API_HTTP_CLIENT_PATH = "/api/http-client";

const buildRequestPayload = (params: HttpRequestParams): HttpRequestParams => {
  const headers = params.headers ?? {};
  return {
    url: params.url.trim(),
    method: params.method || "GET",
    headers,
    ...(params.body === undefined ? {} : { body: params.body }),
  };
};

export const httpClient = async (params: HttpRequestParams): Promise<HttpResponse> => {
  const trimmedUrl = params.url?.trim();

  if (!trimmedUrl) {
    return {
      status: null,
      headers: {},
      body: null,
      error: "Es wurde keine gültige URL für httpClient angegeben.",
    };
  }

  try {
    const apiUrl = resolveApiUrl(API_HTTP_CLIENT_PATH);
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildRequestPayload({ ...params, url: trimmedUrl })),
    });

    if (!response.ok) {
      const message = (await response.text()) || response.statusText;
      return {
        status: null,
        headers: {},
        body: null,
        error: `Backend http-client Fehler: ${message}`,
      };
    }

    const payload = (await response.json()) as Partial<HttpResponse>;
    return {
      status: payload.status ?? null,
      headers: payload.headers ?? {},
      body: payload.body ?? null,
      error: payload.error ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler bei httpClient.";
    return {
      status: null,
      headers: {},
      body: null,
      error: message,
    };
  }
};

export type { HttpRequestParams, HttpResponse };
