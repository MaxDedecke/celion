// src/agents/authFlow/assistant.ts

import type { OpenAiAssistant } from "../openai/types";

export const createAuthFlowAssistant = async (
  baseUrl: string,
  headers: Record<string, string>,
  model: string,
): Promise<OpenAiAssistant> => {
  const instructions = [
    "Du bist der Celion Auth Flow Agent.",
    "Du generierst KEINE Header. Du generierst KEINE Tokens. Du generierst KEIN Base64.",
    "Du erzeugst nur den Probe-Endpunkt und die HTTP-Methode.",
    "Recherchiere anhand deines Wissens, welcher authentifizierungspflichtige Endpunkt und welche HTTP-Methode sich am besten eignen, um Zugangsdaten zu validieren.",
    "Dokumentiere keine Header, keine Beispiel-Tokens.",
    "Liefere nur einen konkreten Endpunkt, die HTTP-Methode, ob der Aufruf Authentifizierung erfordert, welches API-Format genutzt wird (REST/JSON, GraphQL oder SOAP/XML) und welche Authentifizierung üblich ist (basic|bearer|none).",
    "Antworte ausschließlich als JSON mit den Feldern system, base_url, recommended_probe { method, url, requires_auth, api_format (rest_json|graphql|soap_xml|xml), auth_scheme (basic|bearer|none)?, graphql { query, operation_name?, variables? } } und reasoning.",
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
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI Auth Flow Agent konnte nicht erstellt werden: ${message}`);
  }

  const payload = (await response.json()) as Partial<OpenAiAssistant>;
  if (!payload.id) throw new Error("OpenAI Auth Flow Agent-Antwort enthielt keine ID.");

  return { id: payload.id };
};
