import type { SystemDetectionEvidence, SystemDetectionResult, AuthFlowResult } from "@/types/agents";

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
    "Hier hast du API Token oder Username & Password, ein System und seine Base-URL.",
    "Recherchiere anhand deines Wissens, wie man die API des Systems anspricht (REST, GraphQL, SOAP oder proprietäre Varianten) und welche Endpunkte oder Queries geeignet sind, um die Credentials zu validieren.",
    "Setze ausschließlich mit den bereitgestellten Credentials geeignete GET- oder POST-Requests mit eigenen Headern und Bodies (z. B. GraphQL Queries als JSON) ab und werte die Antworten aus. Verwende keine fiktiven oder zufälligen Tokens.",
    "Führe mehrere Versuche durch, bis klar ist, ob die Authentifizierung gelingt. Ziel ist es, mindestens einmal echte Daten abzurufen (z. B. whoami/me-Endpunkte).",
    "Dokumentiere in validation_evidence exakt, welche Endpunkte mit welchen Methoden, Headern und Bodies getestet wurden sowie welche Antworten zurückkamen. Notiere auch, welcher Authorization-Header oder welches Auth-Verfahren mit den gelieferten Credentials verwendet wurde.",
    "Antworte ausschließlich als JSON mit den Feldern authenticated (boolean), auth_method (string), permissions (array von strings), validation_evidence (object), summary (string) und error_message (string oder null).",
    "Die summary muss in einem Satz klarstellen, ob die hinterlegten Credentials valide sind und ob die Schnittstelle erfolgreich angesprochen werden konnte.",
    "Wenn der Zugriff fehlschlägt, erkläre präzise warum und was beim Versuch falsch lief (z. B. fehlende Header, falsches Token, unerwartetes Protokoll).",
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

  let parsed: Partial<AuthFlowResult> | null = null;
  const parseCandidates = [sanitizedContent];
  if (sanitizedContent !== textContent) {
    parseCandidates.push(textContent);
  }

  for (const candidate of parseCandidates) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    throw new Error(`Die Auth Flow Antwort konnte nicht als JSON interpretiert werden. Antwort: ${textContent}`);
  }

  const permissions = Array.isArray(parsed.permissions)
    ? parsed.permissions.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

  const validationEvidence =
    parsed.validation_evidence && typeof parsed.validation_evidence === "object" && !Array.isArray(parsed.validation_evidence)
      ? (parsed.validation_evidence as Record<string, unknown>)
      : {};

  const normalizedSummary =
    typeof parsed.summary === "string" && parsed.summary.trim().length > 0
      ? parsed.summary.trim()
      : parsed.authenticated
        ? "Credentials validiert: Schnittstelle ist erreichbar und authentifizierte Antworten wurden empfangen."
        : "Authentifizierung fehlgeschlagen: Schnittstelle konnte nicht mit den angegebenen Zugangsdaten genutzt werden.";

  const normalizedAuthMethod =
    typeof parsed.auth_method === "string" && parsed.auth_method.trim().length > 0 ? parsed.auth_method : null;

  const normalizedErrorMessage =
    typeof parsed.error_message === "string" && parsed.error_message.trim().length > 0 ? parsed.error_message : null;

  return {
    authenticated: Boolean(parsed.authenticated),
    auth_method: normalizedAuthMethod,
    permissions,
    validation_evidence: validationEvidence,
    summary: normalizedSummary,
    error_message: normalizedErrorMessage,
    raw_output: textContent,
  } satisfies AuthFlowResult;
};

export async function runAuthFlowAgent(
  baseUrl: string,
  system: string,
  authType: "token" | "credentials",
  apiToken?: string,
  username?: string,
  password?: string,
  options: AgentExecutionOptions = {},
): Promise<AuthFlowResult> {
  if (!baseUrl.trim()) {
    throw new Error("Für den Auth Flow Agent wurde keine gültige Base-URL angegeben.");
  }

  const normalizedBaseUrl = baseUrl.trim();
  const { apiKey, baseUrl: openAiBaseUrl, projectId } = resolveOpenAiConfig();
  const model = resolveAuthFlowModel();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const assistant = await createAuthFlowAssistant(openAiBaseUrl, headers, model, options.signal);
  const threadId = await createThread(openAiBaseUrl, headers, options.signal);

  const credentialsDescription = authType === "token"
    ? apiToken
      ? "Hier hast du ein API-Token (sicher im Tool hinterlegt)."
      : "Es wurde kein API-Token bereitgestellt."
    : username && password
      ? `Hier hast du Benutzername (${username}) und ein Passwort (sicher im Tool hinterlegt).`
      : "Benutzername oder Passwort fehlen.";

  const messageContent = [
    `${credentialsDescription} System: ${system}. Base-URL: ${normalizedBaseUrl}. Authentifizierungstyp: ${authType}.`,
    "Recherchiere selbstständig, wie die API dieses Systems angesprochen wird (REST, GraphQL, SOAP etc.) und welche Endpunkte oder Queries sich eignen, um einen ersten Datenzugriff zu testen. Nutze dafür ausschließlich die oben beschriebenen Credentials.",
    "Setze selbstständig echte Requests mit passenden Methoden, Headern und Bodies (z. B. GraphQL Queries als JSON) ab und spiegle die Ergebnisse zurück. Dokumentiere den verwendeten Authorization-Header und weise nach, dass die gelieferten Credentials genutzt wurden.",
    "Starte mindestens einen konkreten Datenzugriff. Wenn du Zugriff erhältst, melde Erfolg, die gefundenen Berechtigungen und bestätige dies in einer summary. Wenn nicht, gib exakt zurück, warum es nicht funktioniert hat und welche Schritte fehlgeschlagen sind, inklusive einer summary.",
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
  return parseAuthFlowResultFromMessage(message);
}

