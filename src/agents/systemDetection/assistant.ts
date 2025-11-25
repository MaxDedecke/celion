// src/agents/systemDetection/assistant.ts

import type { OpenAiAssistant } from "../openai/types";

export const createSystemDetectionAssistant = async (
  baseUrl: string,
  headers: Record<string, string>,
  model: string,
  expectedSystem?: string,
) : Promise<OpenAiAssistant> => {

  const expectedSystemNote = expectedSystem
    ? ` WICHTIG: Der Benutzer erwartet, dass es sich bei der URL um ein "${expectedSystem}"-System handelt. Deine Hauptaufgabe ist es zu validieren, ob die URL tatsächlich zu diesem erwarteten System passt. Setze "systemMatchesUrl" nur dann auf true, wenn der erkannte Subtyp mit "${expectedSystem}" übereinstimmt.`
    : "";

  const instructions = [
    "Du bist der Celion System Detection Agent.",
    "WICHTIG: Der Nutzer gibt eine beliebige URL zu seinem System an (z.B. die URL seines Jira Workspaces wie 'https://company.atlassian.net/jira/...').",
    "Deine Aufgabe ist es, von dieser URL das dahinterliegende System zu identifizieren UND die korrekte API Base-URL abzuleiten.",
    "Schritt 1 – System Detection (mit Curl-HEAD Probe): Nutze zwingend curl_head_probe(url) als ersten Schritt, um Header, Redirects und Server-Signaturen zu erkennen.",
    "curl_head_probe und http_probe rufen das Celion FastAPI Backend als Proxy auf, verwende sie für alle Requests.",
    "Analysiere Header wie www-authenticate, x-monday-region, x-asana-content-type, x-powered-by AJS sowie Hinweise auf Proxies (AtlassianProxy, Envoy, Cloudflare, nginx, Spring Boot).",
    "Führe nur sinnvolle http_probe-Aufrufe auf typischen API-Pfaden aus (/rest/api/3/serverInfo, /graphql, /v2, /soap, /wsdl) und nutze die Ergebnisse zur Klassifikation (REST, GraphQL, SOAP, gRPC).",
    "Klassifiziere Subtypen (z. B. Atlassian-Jira-Cloud) und leite eine empfohlene Base-URL aus Redirects und Pfaden ab.",
    "Antworte ausschließlich im JSON-Format mit den Feldern systemMatchesUrl, apiTypeDetected, apiSubtype, recommendedBaseUrl, confidenceScore, detectionEvidence und rawOutput.",
    "Setze systemMatchesUrl nur auf true, wenn die erkannte API eindeutig zum erwarteten System passt; confidenceScore muss zwischen 0 und 1 liegen.",
    "detectionEvidence darf strukturierte Hinweise (headers, status_codes, redirects, notes) enthalten und rawOutput soll eine kompakte Zusammenfassung der Schritte liefern.",
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
      tools: [
        {
          type: "function",
          function: {
            name: "curl_head_probe",
            description: "Führt einen curl -I HEAD Request über das Backend aus und liefert Header, Status und Redirects.",
            parameters: {
              type: "object",
              properties: {
                url: { type: "string", description: "Vollständige URL, die per HEAD geprüft werden soll" },
                headers: {
                  type: "object",
                  description: "HTTP Header als Key-Value Map",
                  additionalProperties: { type: "string" },
                },
                follow_redirects: {
                  type: "boolean",
                  description: "Ob Redirects automatisch gefolgt werden sollen (Standard: true)",
                },
              },
              required: ["url"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "http_probe",
            description: "Führt GET/POST/HEAD Requests über das Backend aus, um typische API-Pfade zu testen.",
            parameters: {
              type: "object",
              properties: {
                url: { type: "string", description: "Vollständige URL des Requests" },
                method: { type: "string", description: "HTTP Methode" },
                headers: {
                  type: "object",
                  description: "HTTP Header als Key-Value Map",
                  additionalProperties: { type: "string" },
                },
                body: { description: "Request Body (JSON oder Text)" },
              },
              required: ["url", "method"],
            },
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const msg = await response.text().catch(() => response.statusText);
    throw new Error("OpenAI Agent konnte nicht erstellt werden: " + msg);
  }

  const payload = await response.json();
  if (!payload.id) throw new Error("OpenAI Agent-Antwort enthielt keine ID.");

  return { id: payload.id };
};
