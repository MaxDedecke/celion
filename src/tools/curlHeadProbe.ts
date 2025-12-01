import type { CurlHeadProbeParams, CurlHeadProbeResponse } from "@/types/agents";
import { resolveApiUrl } from "../lib/server-helpers";

const API_CURL_HEAD_PROBE_PATH = "/api/curl-head-probe";

export const curlHeadProbe = async (
  params: CurlHeadProbeParams
): Promise<CurlHeadProbeResponse> => {
  const trimmedUrl = params.url?.trim();

  if (!trimmedUrl) {
    return {
      status: null,
      headers: {},
      redirects: [],
      final_url: null,
      raw_response: null,
      error: "Es wurde keine gültige URL für curl_head_probe angegeben.",
    };
  }

  try {
    const apiUrl = resolveApiUrl(API_CURL_HEAD_PROBE_PATH);
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...params, url: trimmedUrl }),
    });

    if (!response.ok) {
      const message = (await response.text()) || response.statusText;
      return {
        status: null,
        headers: {},
        redirects: [],
        final_url: null,
        raw_response: null,
        error: `Backend curl-head-probe Fehler: ${message}`,
      };
    }

    const payload = (await response.json()) as Partial<CurlHeadProbeResponse>;
    return {
      status: payload.status ?? null,
      headers: payload.headers ?? {},
      redirects: payload.redirects ?? [],
      final_url: payload.final_url ?? null,
      raw_response: payload.raw_response ?? null,
      error: payload.error ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler bei curl_head_probe.";
    return {
      status: null,
      headers: {},
      redirects: [],
      final_url: null,
      raw_response: null,
      error: message,
    };
  }
};

export type { CurlHeadProbeParams, CurlHeadProbeResponse };
