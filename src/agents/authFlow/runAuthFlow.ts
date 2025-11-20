// src/agents/authFlow/runAuthFlow.ts

import { resolveOpenAiConfig, buildOpenAiHeaders } from "../openai/openAIClient";
import { createAuthFlowAssistant } from "./assistant";
import { buildAuthFlowPrompt } from "./prompt";
import { createThread, postUserMessage } from "../openai/thread";
import { createRun, waitForRun } from "../openai/run";
import { fetchLatestAssistantMessage, extractMessageText } from "../openai/message";
import { parseAuthFlowResponse } from "./parser";

import type { AuthFlowResult, AuthScheme, ApiRequestFormat } from "@/types/agents";
import { httpClient } from "@/tools/httpRequest";

type AgentExecutionOptions = {
  signal?: AbortSignal;
};

const resolveAuthFlowModel = () => {
  const configured = import.meta.env.VITE_OPENAI_AUTH_FLOW_MODEL?.trim();
  return configured && configured.length > 0 ? configured : "gpt-4.1";
};

const resolveProbeUrl = (probeUrl: string, baseUrl?: string | null) => {
  try {
    return new URL(probeUrl).toString();
  } catch {
    if (!baseUrl) {
      throw new Error("Für die Credential-Probe fehlt eine Basis-URL.");
    }
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return new URL(probeUrl.replace(/^\//, ""), normalizedBase).toString();
  }
};

export const runAuthFlow = async (
  baseUrl: string,
  system: string,
  apiToken: string,
  email: string,
  _password: string,
  options: AgentExecutionOptions = {},
): Promise<AuthFlowResult> => {
  if (!baseUrl?.trim()) {
    throw new Error("Für den Auth Flow Agent wurde keine gültige Base-URL angegeben.");
  }
  if (!apiToken?.trim()) {
    throw new Error("Für den Auth Flow Agent wurde kein API-Token angegeben.");
  }
  if (!email?.trim()) {
    throw new Error("Für den Auth Flow Agent wurde keine E-Mail angegeben.");
  }

  const normalizedBaseUrl = baseUrl.trim();
  const { apiKey, baseUrl: openAiBaseUrl, projectId } = resolveOpenAiConfig();
  const model = resolveAuthFlowModel();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  // 1) Assistant + Thread
  const assistant = await createAuthFlowAssistant(openAiBaseUrl, headers, model);
  const threadId = await createThread(openAiBaseUrl, headers);

  // 2) Prompt senden
  const prompt = buildAuthFlowPrompt(system, normalizedBaseUrl);
  await postUserMessage(openAiBaseUrl, headers, threadId, prompt);

  // 3) Run ausführen
  const run = await createRun(openAiBaseUrl, headers, threadId, assistant.id);
  await waitForRun(openAiBaseUrl, headers, threadId, run.id);

  // 4) Antwort holen + parsen (nur Empfehlung)
  const message = await fetchLatestAssistantMessage(openAiBaseUrl, headers, threadId);
  const text = extractMessageText(message);
  const recommendation = parseAuthFlowResponse(text);

  if (!recommendation.recommended_probe) {
    throw new Error("Der Auth Flow Agent lieferte keinen Probe-Endpunkt zurück.");
  }

  // 5) Probe-Aufruf vorbereiten
  const probeBaseUrl = recommendation.base_url ?? normalizedBaseUrl;
  const resolvedProbeUrl = resolveProbeUrl(recommendation.recommended_probe.url, probeBaseUrl);

  const requestFormat: ApiRequestFormat =
    recommendation.recommended_probe.api_format ?? "rest_json";

  const probeHeaders: Record<string, string> = {};

  if (requestFormat === "graphql" || requestFormat === "rest_json") {
    probeHeaders.Accept = "application/json";
  } else if (requestFormat === "soap_xml" || requestFormat === "xml") {
    probeHeaders.Accept = "application/soap+xml, text/xml";
  } else {
    probeHeaders.Accept = "*/*";
  }

  const credentialPayload = `${email}:${apiToken}`;
  const explicitAuthScheme = recommendation.recommended_probe.auth_scheme;
  const authScheme: AuthScheme =
    explicitAuthScheme && ["basic", "bearer", "none"].includes(explicitAuthScheme)
      ? (explicitAuthScheme as AuthScheme)
      : requestFormat === "graphql"
        ? "bearer"
        : email.trim()
          ? "basic"
          : "bearer";

  if (recommendation.recommended_probe.requires_auth !== false && authScheme !== "none") {
    if (authScheme === "bearer") {
      probeHeaders.Authorization = `Bearer ${apiToken}`;
    } else if (authScheme === "basic") {
      const basic =
        typeof btoa === "function"
          ? btoa(credentialPayload)
          : typeof Buffer !== "undefined"
            ? Buffer.from(credentialPayload).toString("base64")
            : (() => {
                throw new Error("Base64-Encoding wird nicht unterstützt.");
              })();
      probeHeaders.Authorization = `Basic ${basic}`;
    }
  }

  // 6) Body für GraphQL / XML / REST
  const graphqlPayload = recommendation.recommended_probe.graphql;
  let probeBody: unknown = undefined;

  if (requestFormat === "graphql") {
    probeHeaders["Content-Type"] = "application/json";
    const query = graphqlPayload?.query?.trim() || "{ __typename }";
    const operationName = graphqlPayload?.operation_name?.trim();
    const variables = graphqlPayload?.variables ?? null;

    probeBody = {
      query,
      ...(operationName ? { operationName } : {}),
      ...(variables ? { variables } : {}),
    };
  } else if (requestFormat === "soap_xml" || requestFormat === "xml") {
    if (!probeHeaders["Content-Type"]) {
      probeHeaders["Content-Type"] = "application/soap+xml";
    }
  }

  // 7) Probe-Request ausführen
  const probeResult = await httpClient({
    url: resolvedProbeUrl,
    method: recommendation.recommended_probe.method,
    headers: probeHeaders,
    body: probeBody,
  });

  const authenticated =
    probeResult.status !== null && probeResult.status >= 200 && probeResult.status < 300;

  const summary = authenticated
    ? `Credential-Probe erfolgreich (Status ${probeResult.status}).`
    : probeResult.status !== null
      ? `Credential-Probe fehlgeschlagen (Status ${probeResult.status}).`
      : `Credential-Probe konnte nicht ausgeführt werden${probeResult.error ? `: ${probeResult.error}` : ""}.`;

  const errorMessage = authenticated
    ? null
    : probeResult.error ||
      (probeResult.status
        ? `Probe antwortete mit Status ${probeResult.status}.`
        : "Probe konnte nicht ausgeführt werden.");

  // 8) Endresultat zurückgeben
  return {
    ...recommendation,
    recommended_probe: {
      ...recommendation.recommended_probe,
      url: resolvedProbeUrl,
    },
    probe_result: probeResult,
    authenticated,
    summary,
    error_message: errorMessage,
  } satisfies AuthFlowResult;
};
