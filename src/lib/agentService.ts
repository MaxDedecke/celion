import type {
  SystemDetectionEvidence,
  SystemDetectionResult,
  AuthFlowResult,
  AuthFlowRecommendation,
  AuthScheme,
  ApiRequestFormat,
  SchemaDiscoveryResult,
  SchemaObjectDefinition,
} from "@/types/agents";
import { credentialProbe } from "@/tools/credentialProbe";
import { schemaProbe } from "@/tools/schemaProbe";

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_OPENAI_AUTH_MODEL = "gpt-4.1";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENAI_ASSISTANTS_HEADER = "assistants=v2";

type AgentExecutionOptions = {
  signal?: AbortSignal;
};

type OpenAiAssistant = {
  id: string;
};

type OpenAiRun = {
  id: string;
  status: string;
  last_error?: { message?: string } | null;
  required_action?: {
    type?: string;
    submit_tool_outputs?: {
      tool_calls: Array<{
        id: string;
        type: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  } | null;
};

type OpenAiMessageContent = {
  type: string;
  text?: { value?: string } | string;
  input_text?: string;
  [key: string]: unknown;
};

type OpenAiMessage = {
  id: string;
  role: string;
  content: OpenAiMessageContent[];
};

type OpenAiListResponse<T> = {
  data: T[];
};

const resolveOpenAiConfig = () => {
  const apiKey = (import.meta.env.VITE_OPENAI_API_KEY as string | undefined)?.trim();

  if (!apiKey) {
    throw new Error(
      "Es wurde kein OpenAI API-Schlüssel konfiguriert. Bitte hinterlege den Wert in VITE_OPENAI_API_KEY."
    );
  }

  const baseUrl = (
    (import.meta.env.VITE_OPENAI_API_BASE_URL as string | undefined)?.trim() ||
    DEFAULT_OPENAI_BASE_URL
  ).replace(/\/$/, "");

  const projectId = (import.meta.env.VITE_OPENAI_PROJECT_ID as string | undefined)?.trim();
  const model = (
    (import.meta.env.VITE_OPENAI_SYSTEM_DETECTION_MODEL as string | undefined)?.trim() ||
    DEFAULT_OPENAI_MODEL
  ).trim();

  return { apiKey, baseUrl, projectId, model };
};

const resolveAuthFlowModel = () => {
  const configuredModel = (import.meta.env.VITE_OPENAI_AUTH_FLOW_MODEL as string | undefined)?.trim();
  return configuredModel && configuredModel.length > 0 ? configuredModel : DEFAULT_OPENAI_AUTH_MODEL;
};

const buildOpenAiHeaders = (apiKey: string, projectId?: string) => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": OPENAI_ASSISTANTS_HEADER,
  };

  if (projectId) {
    headers["OpenAI-Project"] = projectId;
  }

  return headers;
};

const createAssistant = async (
  baseUrl: string,
  headers: Record<string, string>,
  model: string,
  expectedSystem?: string,
  signal?: AbortSignal,
): Promise<OpenAiAssistant> => {
  const expectedSystemNote = expectedSystem
    ? ` WICHTIG: Der Benutzer erwartet, dass es sich bei der URL um ein "${expectedSystem}"-System handelt. Deine Hauptaufgabe ist es zu validieren, ob die URL tatsächlich zu diesem erwarteten System passt. Setze "detected" nur dann auf true, wenn das erkannte System mit "${expectedSystem}" übereinstimmt.`
    : "";

  const instructions = [
    "Du bist der Celion System Detection Agent.",
    "WICHTIG: Der Nutzer gibt eine beliebige URL zu seinem System an (z.B. die URL seines Jira Workspaces wie 'https://company.atlassian.net/jira/...').",
    "Deine Aufgabe ist es, von dieser URL das dahinterliegende System zu identifizieren UND die korrekte API Base-URL abzuleiten.",
    "Beispiel: Aus 'https://company.atlassian.net/jira/for-you' leitest du ab: System='Jira Cloud', base_url='https://company.atlassian.net', api_version='3'.",
    "Nutze den Probe Runner, um verschiedene bekannte API-Endpunkte zu testen und das System zu verifizieren.",
    "Analysiere die bereitgestellte System-URL und validiere, ob sie zum erwarteten Systemtyp passt.",
    "Falls verfügbar, gib auch die vermutete API-Version, relevante HTTP-Header sowie Status-Codes an.",
    "Antworte ausschließlich im JSON-Format und verwende die Felder detected, system, api_version, confidence, base_url, detection_evidence und raw_output.",
    "Setze detected auf true, falls das System mit dem erwarteten Typ übereinstimmt und ausreichend Hinweise vorliegen, andernfalls false.",
    "Confidence soll ein Wert zwischen 0 und 1 sein, der die Sicherheit der Erkennung widerspiegelt.",
    "detection_evidence darf zusätzliche strukturierte Hinweise enthalten (z. B. headers als Liste oder status_codes als Objekt).",
    expectedSystemNote,
  ].join(" ");

  const response = await fetch(`${baseUrl}/assistants`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      name: "Celion System Detection",
      description: "Erkennt Zielsysteme anhand einer URL für Celion Migrationen.",
      instructions,
    }),
    signal,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI Agent konnte nicht erstellt werden: ${message}`);
  }

  const payload = (await response.json()) as Partial<OpenAiAssistant>;

  if (!payload.id) {
    throw new Error("OpenAI Agent-Antwort enthielt keine ID.");
  }

  return { id: payload.id };
};

const createAuthFlowAssistant = async (
  baseUrl: string,
  headers: Record<string, string>,
  model: string,
  signal?: AbortSignal,
): Promise<OpenAiAssistant> => {
  const instructions = [
    "Du bist der Celion Auth Flow Agent.",
    "Du generierst KEINE Header. Du generierst KEINE Tokens. Du generierst KEIN Base64. Du erzeugst nur den Probe-Endpunkt und die HTTP-Methode.",
    "Recherchiere anhand deines Wissens, welcher authentifizierungspflichtige Endpunkt und welche HTTP-Methode sich am besten eignen, um Zugangsdaten zu validieren.",
    "Dokumentiere keine Header, keine Beispiel-Tokens. Liefere nur einen konkreten Endpunkt, die HTTP-Methode, ob der Aufruf Authentifizierung erfordert, welches API-Format genutzt wird (REST/JSON, GraphQL oder SOAP/XML) und welche Authentifizierung üblich ist (basic|bearer|none).",
    "Antworte ausschließlich als JSON mit den Feldern system, base_url, recommended_probe { method, url, requires_auth, api_format (rest_json|graphql|soap_xml|xml), auth_scheme (basic|bearer|none)?, graphql { query, operation_name?, variables? } } und reasoning. Keine weiteren Felder, keine Platzhalter.",
    "Gib für die URL immer die vollständige und kanonische API-Route an (z.B. https://api.monday.com/v2).",
    "Erkläre in reasoning kurz, warum der Endpunkt authentifizierte Daten liefert und welches Format (REST/GraphQL/SOAP) erforderlich ist.",
  ].join(" ");

  const response = await fetch(`${baseUrl}/assistants`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      name: "Celion Auth Flow",
      description: "Validiert API-Credentials für Celion Migrationen.",
      instructions,
    }),
    signal,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI Auth Flow Agent konnte nicht erstellt werden: ${message}`);
  }

  const payload = (await response.json()) as Partial<OpenAiAssistant>;

  if (!payload.id) {
    throw new Error("OpenAI Auth Flow Agent-Antwort enthielt keine ID.");
  }

  return { id: payload.id };
};

const createThread = async (
  baseUrl: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
) => {
  const response = await fetch(`${baseUrl}/threads`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
    signal,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI Thread konnte nicht erstellt werden: ${message}`);
  }

  const payload = (await response.json()) as { id?: string };

  if (!payload.id) {
    throw new Error("OpenAI Thread-Antwort enthielt keine ID.");
  }

  return payload.id;
};

const postThreadMessage = async (
  baseUrl: string,
  headers: Record<string, string>,
  threadId: string,
  url: string,
  expectedSystem?: string,
  signal?: AbortSignal,
) => {
  const message = expectedSystem
    ? `Validiere, ob die URL "${url}" zum erwarteten System "${expectedSystem}" gehört. Prüfe, ob die API hinter dieser URL mit dem erwarteten Systemtyp übereinstimmt. Gib das Ergebnis als JSON im oben beschriebenen Format zurück.`
    : `Führe eine Systemerkennung für folgende Basis-URL durch: ${url}. Bitte gib das Ergebnis als JSON im oben beschriebenen Format zurück.`;

  const response = await fetch(`${baseUrl}/threads/${threadId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      role: "user",
      content: [
        {
          type: "text",
          text: message,
        },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`Die Eingabenachricht konnte nicht an den Agenten gesendet werden: ${message}`);
  }
};

const createRun = async (
  baseUrl: string,
  headers: Record<string, string>,
  threadId: string,
  assistantId: string,
  signal?: AbortSignal,
): Promise<OpenAiRun> => {
  const response = await fetch(`${baseUrl}/threads/${threadId}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ assistant_id: assistantId }),
    signal,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`Der Agent-Run konnte nicht gestartet werden: ${message}`);
  }

  const payload = (await response.json()) as Partial<OpenAiRun>;

  if (!payload.id) {
    throw new Error("OpenAI Run-Antwort enthielt keine ID.");
  }

  return { id: payload.id, status: payload.status ?? "queued" };
};

const submitToolOutputs = async (
  baseUrl: string,
  headers: Record<string, string>,
  threadId: string,
  runId: string,
  toolOutputs: Array<{ tool_call_id: string; output: string }>,
  signal?: AbortSignal,
) => {
  const response = await fetch(`${baseUrl}/threads/${threadId}/runs/${runId}/submit_tool_outputs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tool_outputs: toolOutputs }),
    signal,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`Tool-Ausgaben konnten nicht übermittelt werden: ${message}`);
  }
};

const pollRunStatus = async (
  baseUrl: string,
  headers: Record<string, string>,
  threadId: string,
  runId: string,
  signal?: AbortSignal,
) => {
  let attempts = 0;
  const maxAttempts = 60;

  while (attempts < maxAttempts) {
    const response = await fetch(`${baseUrl}/threads/${threadId}/runs/${runId}`, {
      method: "GET",
      headers,
      signal,
    });

    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText);
      throw new Error(`Status des Agent-Runs konnte nicht ermittelt werden: ${message}`);
    }

    const payload = (await response.json()) as OpenAiRun;

    if (payload.status === "completed") {
      return payload;
    }

    if (payload.status === "failed" || payload.status === "cancelled" || payload.status === "expired") {
      const errorMessage =
        payload.last_error?.message || `Agent-Run wurde mit Status ${payload.status} beendet.`;
      throw new Error(errorMessage);
    }

    attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error("Agent-Run hat nicht rechtzeitig geantwortet.");
};

const fetchLatestAssistantMessage = async (
  baseUrl: string,
  headers: Record<string, string>,
  threadId: string,
  signal?: AbortSignal,
): Promise<OpenAiMessage | null> => {
  const response = await fetch(`${baseUrl}/threads/${threadId}/messages?limit=5`, {
    method: "GET",
    headers,
    signal,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`Agent-Nachrichten konnten nicht geladen werden: ${message}`);
  }

  const payload = (await response.json()) as OpenAiListResponse<OpenAiMessage>;

  if (!payload?.data || payload.data.length === 0) {
    return null;
  }

  return payload.data.find((message) => message.role === "assistant") ?? payload.data[0] ?? null;
};

const extractAssistantMessageText = (message: OpenAiMessage | null) => {
  if (!message) {
    throw new Error("Der Agent lieferte keine Antwort zurück.");
  }

  const textContent = message.content
    .map((entry) => {
      if (entry.type === "text") {
        if (typeof entry.text === "string") {
          return entry.text;
        }

        if (entry.text && typeof entry.text === "object" && typeof entry.text.value === "string") {
          return entry.text.value;
        }
      }

      if (entry.type === "input_text" && typeof entry.input_text === "string") {
        return entry.input_text;
      }

      if (typeof entry.text === "string") {
        return entry.text;
      }

      return "";
    })
    .filter((chunk) => typeof chunk === "string" && chunk.trim().length > 0)
    .join("\n");

  if (!textContent) {
    throw new Error("Die Agent-Antwort enthielt keinen Text.");
  }

  return textContent;
};

const extractJsonPayload = (content: string) => {
  const trimmed = content.trim();

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && typeof fencedMatch[1] === "string") {
    return fencedMatch[1].trim();
  }

  const firstBraceIndex = trimmed.indexOf("{");
  const lastBraceIndex = trimmed.lastIndexOf("}");

  if (firstBraceIndex !== -1 && lastBraceIndex !== -1 && lastBraceIndex > firstBraceIndex) {
    return trimmed.slice(firstBraceIndex, lastBraceIndex + 1).trim();
  }

  return trimmed;
};

const parseDetectionResultFromMessage = (message: OpenAiMessage | null, baseUrl: string) => {
  const textContent = extractAssistantMessageText(message);

  const sanitizedContent = extractJsonPayload(textContent);

  let parsed: Partial<SystemDetectionResult & { detection_evidence?: SystemDetectionEvidence }> | null = null;
  const parseCandidates = [sanitizedContent];
  if (sanitizedContent !== textContent) {
    parseCandidates.push(textContent);
  }

  for (const candidate of parseCandidates) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch (error) {
      parsed = null;
    }
  }

  if (!parsed) {
    throw new Error(
      `Die Agent-Antwort konnte nicht als JSON interpretiert werden. Antwort: ${textContent}`,
    );
  }

  const evidence =
    parsed?.detection_evidence && typeof parsed.detection_evidence === "object"
      ? (parsed.detection_evidence as SystemDetectionEvidence)
      : {};

  let confidence: number | null = null;
  if (typeof parsed?.confidence === "number" && Number.isFinite(parsed.confidence)) {
    confidence = parsed.confidence;
  } else if (typeof parsed?.confidence === "string") {
    const parsedNumber = Number.parseFloat(parsed.confidence);
    confidence = Number.isFinite(parsedNumber) ? parsedNumber : null;
  }

  return {
    detected: Boolean(parsed?.detected),
    system: parsed?.system ?? null,
    api_version: parsed?.api_version ?? null,
    confidence,
    base_url: parsed?.base_url ?? baseUrl,
    detection_evidence: evidence,
    raw_output: textContent,
  } satisfies SystemDetectionResult;
};

export const runSystemDetectionAgent = async (
  url: string,
  expectedSystem?: string,
  options: AgentExecutionOptions = {},
): Promise<SystemDetectionResult> => {
  if (!url || !url.trim()) {
    throw new Error("Es wurde keine gültige URL für die Systemerkennung angegeben.");
  }

  const trimmedUrl = url.trim();
  const { apiKey, baseUrl, projectId, model } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const assistant = await createAssistant(baseUrl, headers, model, expectedSystem, options.signal);
  const threadId = await createThread(baseUrl, headers, options.signal);
  await postThreadMessage(baseUrl, headers, threadId, trimmedUrl, expectedSystem, options.signal);
  const run = await createRun(baseUrl, headers, threadId, assistant.id, options.signal);
  await pollRunStatus(baseUrl, headers, threadId, run.id, options.signal);
  const message = await fetchLatestAssistantMessage(baseUrl, headers, threadId, options.signal);

  return parseDetectionResultFromMessage(message, trimmedUrl);
};
const processRunUntilComplete = async (
  baseUrl: string,
  headers: Record<string, string>,
  threadId: string,
  runId: string,
  signal?: AbortSignal,
) => {
  let attempts = 0;
  const maxAttempts = 120;

  while (attempts < maxAttempts) {
    const response = await fetch(`${baseUrl}/threads/${threadId}/runs/${runId}`, {
      method: "GET",
      headers,
      signal,
    });

    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText);
      throw new Error(`Status des Auth Flow Runs konnte nicht ermittelt werden: ${message}`);
    }

    const run = (await response.json()) as OpenAiRun;

    if (run.status === "completed") {
      return run;
    }
    if (run.status === "requires_action") {
      throw new Error("Auth Flow Agent hat unerwartet eine Tool-Aktion angefordert.");
    } else if (run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
      const errorMessage = run.last_error?.message || `Agent-Run wurde mit Status ${run.status} beendet.`;
      throw new Error(errorMessage);
    }

    attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error("Auth Flow Agent-Run hat nicht rechtzeitig geantwortet.");
};

const parseAuthFlowResultFromMessage = (message: OpenAiMessage | null): AuthFlowResult => {
  const textContent = extractAssistantMessageText(message);
  const sanitizedContent = extractJsonPayload(textContent);

  let parsed: Record<string, unknown> | null = null;
  const parseCandidates = [sanitizedContent];
  if (sanitizedContent !== textContent) {
    parseCandidates.push(textContent);
  }

  for (const candidate of parseCandidates) {
    try {
      const candidateObject = JSON.parse(candidate);
      if (candidateObject && typeof candidateObject === "object" && !Array.isArray(candidateObject)) {
        parsed = candidateObject as Record<string, unknown>;
        break;
      }
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    throw new Error(`Die Auth Flow Antwort konnte nicht als JSON interpretiert werden. Antwort: ${textContent}`);
  }

  const system = typeof parsed.system === "string" && parsed.system.trim().length > 0 ? parsed.system.trim() : null;
  const baseUrl = typeof parsed.base_url === "string" && parsed.base_url.trim().length > 0 ? parsed.base_url.trim() : null;
  const reasoning = typeof parsed.reasoning === "string" && parsed.reasoning.trim().length > 0 ? parsed.reasoning.trim() : null;

  let recommendedProbe: AuthFlowResult["recommended_probe"] = null;
  if (parsed.recommended_probe && typeof parsed.recommended_probe === "object" && !Array.isArray(parsed.recommended_probe)) {
    const probe = parsed.recommended_probe as Record<string, unknown>;
    const method = typeof probe.method === "string" && probe.method.trim().length > 0 ? probe.method.trim().toUpperCase() : null;
    const url = typeof probe.url === "string" && probe.url.trim().length > 0 ? probe.url.trim() : null;
    const requiresAuth =
      typeof probe.requires_auth === "boolean" ? probe.requires_auth : probe.requires_auth === undefined ? true : Boolean(probe.requires_auth);

    const rawApiFormat = typeof probe.api_format === "string" ? probe.api_format.trim().toLowerCase() : null;
    const apiFormat: AuthFlowRecommendation["api_format"] =
      rawApiFormat === "graphql" || rawApiFormat === "rest_json" || rawApiFormat === "soap_xml" || rawApiFormat === "xml"
        ? (rawApiFormat as AuthFlowRecommendation["api_format"])
        : undefined;

    const rawAuthScheme = typeof probe.auth_scheme === "string" ? probe.auth_scheme.trim().toLowerCase() : null;
    const authScheme: AuthFlowRecommendation["auth_scheme"] =
      rawAuthScheme === "bearer" || rawAuthScheme === "basic" || rawAuthScheme === "none"
        ? (rawAuthScheme as AuthFlowRecommendation["auth_scheme"])
        : undefined;

    let graphqlConfig: AuthFlowRecommendation["graphql"] = null;
    if (probe.graphql && typeof probe.graphql === "object" && !Array.isArray(probe.graphql)) {
      const graphql = probe.graphql as Record<string, unknown>;
      const query = typeof graphql.query === "string" && graphql.query.trim().length > 0 ? graphql.query.trim() : null;
      const operationName =
        typeof graphql.operation_name === "string" && graphql.operation_name.trim().length > 0
          ? graphql.operation_name.trim()
          : null;
      const variables = graphql.variables && typeof graphql.variables === "object" && !Array.isArray(graphql.variables)
        ? (graphql.variables as Record<string, unknown>)
        : null;

      if (query) {
        graphqlConfig = { query, operation_name: operationName, variables };
      }
    }

    if (method && url) {
      recommendedProbe = { method, url, requires_auth: requiresAuth };
      if (apiFormat) {
        recommendedProbe.api_format = apiFormat;
      }
      if (authScheme) {
        recommendedProbe.auth_scheme = authScheme;
      }
      recommendedProbe.graphql = graphqlConfig;
    }
  }

  return {
    system,
    base_url: baseUrl,
    recommended_probe: recommendedProbe,
    reasoning,
    probe_result: null,
    authenticated: null,
    summary: null,
    error_message: null,
    raw_output: textContent,
  } satisfies AuthFlowResult;
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

export async function runAuthFlowAgent(
  baseUrl: string,
  system: string,
  apiToken: string,
  email: string,
  _password: string,
  options: AgentExecutionOptions = {},
): Promise<AuthFlowResult> {
  if (!baseUrl.trim()) {
    throw new Error("Für den Auth Flow Agent wurde keine gültige Base-URL angegeben.");
  }

  if (!apiToken.trim()) {
    throw new Error("Für den Auth Flow Agent wurde kein API-Token angegeben.");
  }

  if (!email.trim()) {
    throw new Error("Für den Auth Flow Agent wurde keine E-Mail angegeben.");
  }

  const normalizedBaseUrl = baseUrl.trim();
  const { apiKey, baseUrl: openAiBaseUrl, projectId } = resolveOpenAiConfig();
  const model = resolveAuthFlowModel();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const assistant = await createAuthFlowAssistant(openAiBaseUrl, headers, model, options.signal);
  const threadId = await createThread(openAiBaseUrl, headers, options.signal);

  const messageContent = [
    `System: ${system}. Base-URL: ${normalizedBaseUrl}.`,
    "Liefere nur Endpunkt und HTTP Methode für Authentifizierung.",
    "Antworte ausschließlich als JSON mit den Feldern system, base_url, recommended_probe { method, url, requires_auth, api_format (rest_json|graphql|soap_xml|xml), auth_scheme (basic|bearer|none)?, graphql { query, operation_name?, variables? } }, reasoning.",
    "Keine Header, keine Beispiel-Tokens, kein Base64, keine Platzhalter. Falls GraphQL erforderlich ist, gib den passenden GraphQL-Query an. Gib immer die vollständige API-URL zurück (z.B. https://api.monday.com/v2).",
  ].join(" ");

  const messageResponse = await fetch(`${openAiBaseUrl}/threads/${threadId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      role: "user",
      content: [
        {
          type: "text",
          text: messageContent,
        },
      ],
    }),
    signal: options.signal,
  });

  if (!messageResponse.ok) {
    const message = await messageResponse.text().catch(() => messageResponse.statusText);
    throw new Error(`Die Authentifizierungsnachricht konnte nicht gesendet werden: ${message}`);
  }

  const run = await createRun(openAiBaseUrl, headers, threadId, assistant.id, options.signal);

  await processRunUntilComplete(
    openAiBaseUrl,
    headers,
    threadId,
    run.id,
    options.signal,
  );

  const message = await fetchLatestAssistantMessage(openAiBaseUrl, headers, threadId, options.signal);
  const recommendation = parseAuthFlowResultFromMessage(message);

  if (!recommendation.recommended_probe) {
    throw new Error("Der Auth Flow Agent lieferte keinen Probe-Endpunkt zurück.");
  }

  const probeBaseUrl = recommendation.base_url ?? normalizedBaseUrl;
  const resolvedProbeUrl = resolveProbeUrl(recommendation.recommended_probe.url, probeBaseUrl);

  const requestFormat: ApiRequestFormat = recommendation.recommended_probe.api_format ?? "rest_json";
  const probeHeaders: Record<string, string> = {};

  if (requestFormat === "graphql" || requestFormat === "rest_json") {
    probeHeaders.Accept = "application/json";
  } else if (requestFormat === "soap_xml" || requestFormat === "xml") {
    probeHeaders.Accept = "application/soap+xml, text/xml";
  } else {
    probeHeaders.Accept = "*/*";
  }

  const credentialPayload = `${email}:${apiToken}`;
  const authScheme: AuthScheme =
    recommendation.recommended_probe.auth_scheme && ["basic", "bearer", "none"].includes(recommendation.recommended_probe.auth_scheme)
      ? (recommendation.recommended_probe.auth_scheme as AuthScheme)
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

  const probeResult = await credentialProbe({
    url: resolvedProbeUrl,
    method: recommendation.recommended_probe.method,
    headers: probeHeaders,
    body: probeBody,
    request_format: requestFormat,
    graphql: graphqlPayload ?? null,
  });

  const authenticated = probeResult.status !== null && probeResult.status >= 200 && probeResult.status < 300;
  const summary = authenticated
    ? `Credential-Probe erfolgreich (Status ${probeResult.status}).`
    : probeResult.status !== null
      ? `Credential-Probe fehlgeschlagen (Status ${probeResult.status}).`
      : `Credential-Probe konnte nicht ausgeführt werden${probeResult.error ? `: ${probeResult.error}` : ""}.`;

  const errorMessage = authenticated
    ? null
    : probeResult.error || (probeResult.status ? `Probe antwortete mit Status ${probeResult.status}.` : "Probe konnte nicht ausgeführt werden.");

  return {
    ...recommendation,
    recommended_probe: { ...recommendation.recommended_probe, url: resolvedProbeUrl },
    probe_result: probeResult,
    authenticated,
    summary,
    error_message: errorMessage,
  } satisfies AuthFlowResult;
}

const buildSchemaAuthHeaders = (apiToken: string, email?: string, password?: string) => {
  const headers: Record<string, string> = { Accept: "application/json" };

  const normalizedToken = apiToken.trim();
  const normalizedEmail = (email ?? "").trim();
  const normalizedPassword = (password ?? "").trim();

  if (normalizedToken && normalizedEmail && normalizedPassword) {
    const payload = `${normalizedEmail}:${normalizedToken}`;
    const encoded = typeof btoa === "function"
      ? btoa(payload)
      : typeof Buffer !== "undefined"
        ? Buffer.from(payload).toString("base64")
        : "";
    if (encoded) {
      headers.Authorization = `Basic ${encoded}`;
    }
  } else if (normalizedToken) {
    headers.Authorization = `Bearer ${normalizedToken}`;
  }

  return headers;
};

const extractFieldsFromBody = (body: unknown): { fields: SchemaObjectDefinition["fields"]; sampleCount: number | null } => {
  if (!body) {
    return { fields: [], sampleCount: null };
  }

  if (Array.isArray(body)) {
    const firstEntry = body.find((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
    if (!firstEntry || typeof firstEntry !== "object") {
      return { fields: [], sampleCount: body.length };
    }

    const fields = Object.entries(firstEntry as Record<string, unknown>).map(([key, value]) => ({
      name: key,
      type: value === null || value === undefined ? null : typeof value,
      sample_value: value,
    }));

    return { fields, sampleCount: body.length };
  }

  if (typeof body === "object") {
    const fields = Object.entries(body as Record<string, unknown>).map(([key, value]) => ({
      name: key,
      type: value === null || value === undefined ? null : typeof value,
      sample_value: value,
    }));

    return { fields, sampleCount: 1 };
  }

  return { fields: [], sampleCount: null };
};

export const runSchemaDiscoveryAgent = async (
  baseUrl: string,
  system: string,
  apiToken: string,
  email?: string,
  password?: string,
): Promise<SchemaDiscoveryResult> => {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const headers = buildSchemaAuthHeaders(apiToken, email, password);

  const candidateEndpoints: Array<{ name: string; path: string }> = [
    { name: "Projects", path: "/projects" },
    { name: "Issues", path: "/issues" },
    { name: "Tasks", path: "/tasks" },
    { name: "Items", path: "/items" },
    { name: "Users", path: "/users" },
  ];

  const objects: SchemaObjectDefinition[] = [];

  for (const candidate of candidateEndpoints) {
    const url = `${normalizedBase}${candidate.path}`;
    const probe = await schemaProbe({ url, method: "GET", headers });

    const { fields, sampleCount } = extractFieldsFromBody(probe.body);

    objects.push({
      name: candidate.name,
      endpoint: url,
      status: probe.status,
      success: probe.ok,
      fields,
      sample_count: sampleCount,
      error: probe.error,
    });
  }

  const successfulObjects = objects.filter((object) => object.success && object.fields.length > 0);
  const summaryParts: string[] = [];

  if (successfulObjects.length > 0) {
    summaryParts.push(
      `${successfulObjects.length} von ${objects.length} Endpunkten lieferten strukturierte Felder.`,
    );
  } else {
    summaryParts.push("Keine aussagekräftigen Felder gefunden. Bitte Endpunkte oder Credentials prüfen.");
  }

  const rawOutput = JSON.stringify({ system, base_url: normalizedBase, objects }, null, 2);

  return {
    system,
    base_url: normalizedBase,
    objects,
    summary: summaryParts.join(" "),
    raw_output: rawOutput,
    error_message: successfulObjects.length === 0 ? "Schema Discovery konnte keine Felder extrahieren." : null,
  } satisfies SchemaDiscoveryResult;
};

